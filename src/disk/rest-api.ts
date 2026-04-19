/**
 * Yandex.Disk REST API client (cloud-api.yandex.ru).
 *
 * Used for upload/download of files larger than what the WebDAV gateway can
 * handle (~20 MB per connection — Yandex throttles WebDAV deliberately).
 *
 * REST API requires an OAuth token (NOT the app password used for WebDAV).
 * Get one at https://oauth.yandex.ru/ — register an app with "cloud_api:disk.read"
 * + "cloud_api:disk.write" scopes, then exchange for a token.
 *
 * Flow:
 *   1. GET /v1/disk/resources/upload?path=X&overwrite=true → { href, method }
 *   2. PUT to href (CDN endpoint, e.g. uploader1g.disk.yandex.net) with the file body.
 *      No auth on the CDN URL — the path itself is signed.
 *
 * Symmetric for download via /v1/disk/resources/download.
 */

const REST_BASE = "https://cloud-api.yandex.ru/v1/disk";

/** Append a diagnostic line to the progress log, if opt-in env var is set. */
async function trace(msg: string): Promise<void> {
  const progressPath = process.env.YAD_UPLOAD_PROGRESS;
  if (!progressPath) return;
  try {
    const fs = await import("node:fs");
    const ts = new Date().toISOString();
    fs.appendFileSync(progressPath, `[${ts}] ${msg}\n`);
  } catch {}
}

interface UploadHrefResponse {
  href: string;
  method: string;
  templated?: boolean;
}

interface DownloadHrefResponse {
  href: string;
  method: string;
  templated?: boolean;
}

interface ApiErrorResponse {
  message?: string;
  description?: string;
  error?: string;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function formatApiError(prefix: string, status: number, body: unknown): Error {
  const e = body as ApiErrorResponse;
  const detail = e?.description || e?.message || e?.error || JSON.stringify(body).slice(0, 200);
  return new Error(`${prefix}: ${status} ${detail}`);
}

/** Get a temporary upload URL for the given remote path. */
async function getUploadHref(
  token: string,
  remotePath: string,
  overwrite: boolean,
): Promise<string> {
  const url = `${REST_BASE}/resources/upload?path=${encodeURIComponent(remotePath)}&overwrite=${overwrite}`;
  await trace(`getUploadHref: GET ${url}`);
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `OAuth ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  await trace(`getUploadHref: status=${res.status}`);
  const body = await readJson(res);
  if (!res.ok) {
    throw formatApiError(`Yandex REST get-upload-href ${remotePath} failed`, res.status, body);
  }
  const href = (body as UploadHrefResponse).href;
  await trace(`getUploadHref: got href host=${new URL(href).hostname}`);
  return href;
}

/** Get a temporary download URL for the given remote path. */
async function getDownloadHref(token: string, remotePath: string): Promise<string> {
  const url = `${REST_BASE}/resources/download?path=${encodeURIComponent(remotePath)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `OAuth ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await readJson(res);
  if (!res.ok) {
    throw formatApiError(`Yandex REST get-download-href ${remotePath} failed`, res.status, body);
  }
  return (body as DownloadHrefResponse).href;
}

/** PUT a local file to the temporary upload URL using node:https streaming. */
async function putToUploadUrl(uploadUrl: string, localPath: string): Promise<{ bytes: number }> {
  const fs = await import("node:fs");
  const https = await import("node:https");
  const { URL } = await import("node:url");

  const stat = fs.statSync(localPath);
  const url = new URL(uploadUrl);

  const progressPath = process.env.YAD_UPLOAD_PROGRESS;
  let bytesSent = 0;
  let progressTimer: NodeJS.Timeout | undefined;
  const start = Date.now();
  if (progressPath) {
    fs.writeFileSync(progressPath, `[REST] start size=${stat.size}\n`);
    progressTimer = setInterval(() => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const pct = ((bytesSent / stat.size) * 100).toFixed(1);
      fs.appendFileSync(progressPath, `t=${elapsed}s sent=${bytesSent}/${stat.size} (${pct}%)\n`);
    }, 1000);
  }

  return await new Promise<{ bytes: number }>((resolve, reject) => {
    let settled = false;
    const settle = (err: Error | null) => {
      if (settled) return;
      settled = true;
      if (progressTimer) clearInterval(progressTimer);
      if (progressPath) {
        fs.appendFileSync(
          progressPath,
          err ? `error sent=${bytesSent}: ${err.message}\n` : `done sent=${bytesSent}\n`,
        );
      }
      if (err) reject(err);
      else resolve({ bytes: bytesSent });
    };

    const req = https.request({
      method: "PUT",
      hostname: url.hostname,
      port: url.port ? Number(url.port) : 443,
      path: url.pathname + url.search,
      headers: {
        "Content-Length": String(stat.size),
        "Content-Type": "application/octet-stream",
      },
    });

    void trace(`putToUploadUrl: PUT ${url.hostname}${url.pathname.substring(0, 60)}...`);

    req.on("error", (err) => {
      void trace(`putToUploadUrl: req error: ${err.message}`);
      settle(err);
    });

    req.on("socket", (socket) => {
      socket.once("connect", () => {
        void trace("putToUploadUrl: socket connected");
      });
    });

    req.on("response", (res) => {
      void trace(`putToUploadUrl: response ${res.statusCode}`);
      let body = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        const sc = res.statusCode ?? 0;
        if (sc >= 200 && sc < 300) settle(null);
        else
          settle(
            new Error(
              `Yandex REST PUT failed: ${sc} ${res.statusMessage}${body ? ` — ${body.slice(0, 200)}` : ""}`,
            ),
          );
      });
      res.on("error", (err) => settle(err));
    });

    // Generous timeout — REST CDN should be fast, but Yandex still hashes
    // server-side after upload. 5 min is comfortably above that.
    req.setTimeout(5 * 60 * 1000, () => {
      req.destroy(new Error("REST PUT timed out after 5 minutes"));
    });

    const fileStream = fs.createReadStream(localPath);
    fileStream.on("data", (chunk: Buffer) => {
      bytesSent += chunk.length;
    });
    fileStream.on("error", (err) => {
      req.destroy(err);
      settle(err);
    });
    fileStream.pipe(req);
  });
}

/** GET from the temporary download URL, streaming to a local file. */
async function getFromDownloadUrl(
  downloadUrl: string,
  localPath: string,
): Promise<{ bytes: number; contentType: string }> {
  const fs = await import("node:fs");
  const { Readable } = await import("node:stream");
  const { pipeline } = await import("node:stream/promises");

  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`Yandex REST GET failed: ${res.status} ${res.statusText}`);
  }
  if (!res.body) {
    throw new Error("Yandex REST GET returned no body");
  }
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const writeStream = fs.createWriteStream(localPath);
  const source = Readable.fromWeb(res.body as never);
  try {
    await pipeline(source, writeStream);
  } catch (err) {
    try {
      fs.unlinkSync(localPath);
    } catch {}
    throw err;
  }
  return { bytes: writeStream.bytesWritten, contentType };
}

/** GET from the temporary download URL, returning a Buffer. */
async function getBufferFromDownloadUrl(downloadUrl: string): Promise<Buffer> {
  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`Yandex REST GET failed: ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Upload a local file via REST API (two-step: get URL, then PUT). */
export async function restUploadFile(
  token: string,
  remotePath: string,
  localPath: string,
  overwrite = true,
): Promise<{ bytes: number }> {
  const href = await getUploadHref(token, remotePath, overwrite);
  return await putToUploadUrl(href, localPath);
}

/** Download a remote file via REST API to a local path (streaming). */
export async function restDownloadToFile(
  token: string,
  remotePath: string,
  localPath: string,
): Promise<{ bytes: number; contentType: string }> {
  const href = await getDownloadHref(token, remotePath);
  return await getFromDownloadUrl(href, localPath);
}

/** Download a remote file via REST API into memory (for small in-context usage). */
export async function restDownloadBuffer(token: string, remotePath: string): Promise<Buffer> {
  const href = await getDownloadHref(token, remotePath);
  return await getBufferFromDownloadUrl(href);
}
