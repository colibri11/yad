/**
 * Lightweight WebDAV client for Yandex.Disk.
 * Uses native fetch — no extra dependencies.
 */

const WEBDAV_BASE = "https://webdav.yandex.ru";
const TIMEOUT_MS = 30_000;

export interface WebDavAuth {
  login: string;
  password: string;
}

function authHeader(auth: WebDavAuth): string {
  const encoded = Buffer.from(`${auth.login}:${auth.password}`).toString("base64");
  return `Basic ${encoded}`;
}

function fullUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const encoded = normalized
    .split("/")
    .map((seg) => (seg ? encodeURIComponent(seg) : seg))
    .join("/");
  return `${WEBDAV_BASE}${encoded}`;
}

export interface DavResource {
  href: string;
  displayName: string;
  isCollection: boolean;
  contentLength: number;
  contentType: string;
  lastModified: string;
  creationDate: string;
}

/** Parse a WebDAV multistatus XML response into resource entries */
export function parseMultistatus(xml: string): DavResource[] {
  const resources: DavResource[] = [];
  const responseRegex = /<(?:d|D):response>([\s\S]*?)<\/(?:d|D):response>/g;

  for (let match = responseRegex.exec(xml); match !== null; match = responseRegex.exec(xml)) {
    const block = match[1];
    resources.push({
      href: decodeURIComponent(extractTag(block, "href") || ""),
      displayName: extractTag(block, "displayname") || "",
      isCollection: block.includes("<d:collection") || block.includes("<D:collection"),
      contentLength: parseInt(extractTag(block, "getcontentlength") || "0", 10),
      contentType: extractTag(block, "getcontenttype") || "",
      lastModified: extractTag(block, "getlastmodified") || "",
      creationDate: extractTag(block, "creationdate") || "",
    });
  }
  return resources;
}

function extractTag(xml: string, tagName: string): string | null {
  // Match both d: and D: namespace prefixes, and also unprefixed
  const pattern = new RegExp(
    `<(?:[a-zA-Z]+:)?${tagName}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z]+:)?${tagName}>`,
    "i",
  );
  const m = pattern.exec(xml);
  return m ? m[1].trim() : null;
}

/** PROPFIND — list folder or get resource properties */
export async function propfind(
  auth: WebDavAuth,
  path: string,
  depth: "0" | "1" = "1",
): Promise<DavResource[]> {
  const res = await fetch(fullUrl(path), {
    method: "PROPFIND",
    headers: {
      Authorization: authHeader(auth),
      Depth: depth,
      Accept: "*/*",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok && res.status !== 207) {
    throw new Error(`PROPFIND ${path} failed: ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();
  return parseMultistatus(xml);
}

/** GET — download file, returns Buffer */
export async function download(auth: WebDavAuth, path: string): Promise<Buffer> {
  const res = await fetch(fullUrl(path), {
    method: "GET",
    headers: {
      Authorization: authHeader(auth),
      Accept: "*/*",
    },
  });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** GET — stream file directly to local filesystem path. Returns bytes written and content type. */
export async function downloadToFile(
  auth: WebDavAuth,
  remotePath: string,
  localPath: string,
): Promise<{ bytes: number; contentType: string }> {
  const fs = await import("node:fs");
  const { Readable } = await import("node:stream");
  const { pipeline } = await import("node:stream/promises");

  const res = await fetch(fullUrl(remotePath), {
    method: "GET",
    headers: {
      Authorization: authHeader(auth),
      Accept: "*/*",
    },
  });
  if (!res.ok) {
    throw new Error(`GET ${remotePath} failed: ${res.status} ${res.statusText}`);
  }
  if (!res.body) {
    throw new Error(`GET ${remotePath} returned no body`);
  }

  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const writeStream = fs.createWriteStream(localPath);
  const source = Readable.fromWeb(res.body as never);
  try {
    await pipeline(source, writeStream);
  } catch (err) {
    // Yandex WebDAV does not support resume — leave no partial file behind.
    try {
      fs.unlinkSync(localPath);
    } catch {}
    throw err;
  }
  return { bytes: writeStream.bytesWritten, contentType };
}

/** PUT — upload file */
export async function upload(
  auth: WebDavAuth,
  path: string,
  body: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<void> {
  const res = await fetch(fullUrl(path), {
    method: "PUT",
    headers: {
      Authorization: authHeader(auth),
      "Content-Type": contentType,
    },
    body: typeof body === "string" ? body : new Uint8Array(body),
  });
  if (!res.ok) {
    throw new Error(`PUT ${path} failed: ${res.status} ${res.statusText}`);
  }
}

/** PUT — stream a local file as the request body using node:https (not fetch).
 *
 * Why https.request and not fetch:
 * - undici's fetch buffers the request body in memory instead of streaming it,
 *   and its body backpressure is broken for large bodies (undici #4058, #2014).
 * - Yandex WebDAV expects Expect: 100-continue and breaks if the client sends body
 *   before the server replies with 100. fetch doesn't speak 100-continue.
 *
 * Timeout is adaptive (60s base + 60s per MB, ×2 margin) because Yandex WebDAV
 * delays the 201 response ~60s per MB while it hashes and antivirus-scans the
 * uploaded file. Short timeouts make the upload look failed when it actually
 * succeeded; the adaptive window matches Yandex's documented behaviour.
 */
export async function uploadFromFile(
  auth: WebDavAuth,
  remotePath: string,
  localPath: string,
  contentType = "application/octet-stream",
): Promise<{ bytes: number }> {
  const fs = await import("node:fs");
  const https = await import("node:https");

  const stat = fs.statSync(localPath);
  const url = new URL(fullUrl(remotePath));

  // Optional progress log (opt-in via env var — useful for diagnosing slow uploads).
  const progressPath = process.env.YAD_UPLOAD_PROGRESS;
  let bytesSent = 0;
  let progressTimer: NodeJS.Timeout | undefined;
  const start = Date.now();
  if (progressPath) {
    fs.writeFileSync(progressPath, `start size=${stat.size} target=${remotePath}\n`);
    progressTimer = setInterval(() => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const pct = ((bytesSent / stat.size) * 100).toFixed(1);
      fs.appendFileSync(progressPath, `t=${elapsed}s sent=${bytesSent}/${stat.size} (${pct}%)\n`);
    }, 1000);
  }

  return await new Promise<{ bytes: number }>((resolve, reject) => {
    let settled = false;
    let bodyStarted = false;

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
        Authorization: authHeader(auth),
        "Content-Type": contentType,
        "Content-Length": String(stat.size),
        Expect: "100-continue",
      },
    });

    req.on("error", (err) => settle(err));

    req.on("continue", () => {
      bodyStarted = true;
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

    req.on("response", (res) => {
      let body = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        const sc = res.statusCode ?? 0;
        if (sc >= 200 && sc < 300) {
          settle(null);
        } else {
          settle(
            new Error(
              `PUT ${remotePath} failed: ${sc} ${res.statusMessage}${body ? ` — ${body.slice(0, 200)}` : ""}`,
            ),
          );
        }
      });
      res.on("error", (err) => settle(err));

      // If server replied with a final response without ever sending 100 Continue
      // (e.g. 401, 409), we never started streaming the body. Close the request.
      if (!bodyStarted) {
        req.destroy();
      }
    });

    // Yandex WebDAV deliberately delays the 201 response by ~60s per MB
    // (server-side hash + antivirus scan, documented behaviour). Body transfer
    // itself is fast, but waiting for the final response dominates. Adaptive
    // timeout: 60s base + 60s per MB, plus a 2× safety margin.
    const mb = stat.size / (1024 * 1024);
    const timeoutMs = Math.max(60_000, Math.ceil(60_000 + 60_000 * mb) * 2);
    req.setTimeout(timeoutMs, () => {
      req.destroy(
        new Error(
          `PUT ${remotePath} timed out after ${Math.round(timeoutMs / 1000)}s. ` +
            "Yandex WebDAV throttles ~60s per MB during server-side processing; " +
            "either retry or set disk_oauth_token for faster REST API upload.",
        ),
      );
    });

    // Flush headers so server can respond with 100 Continue (or an error).
    req.flushHeaders();
  });
}

/** Check if a resource exists (PROPFIND with Depth 0, returns false on 404) */
export async function exists(auth: WebDavAuth, path: string): Promise<boolean> {
  const res = await fetch(fullUrl(path), {
    method: "PROPFIND",
    headers: {
      Authorization: authHeader(auth),
      Depth: "0",
      Accept: "*/*",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return false;
  if (res.ok || res.status === 207) return true;
  throw new Error(`PROPFIND ${path} failed: ${res.status} ${res.statusText}`);
}

/** MKCOL — create folder */
export async function mkcol(auth: WebDavAuth, path: string): Promise<void> {
  const res = await fetch(fullUrl(path), {
    method: "MKCOL",
    headers: {
      Authorization: authHeader(auth),
      Accept: "*/*",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`MKCOL ${path} failed: ${res.status} ${res.statusText}`);
  }
}

/** MKCOL recursive — create folder and all missing parents (like mkdir -p) */
export async function mkcolRecursive(auth: WebDavAuth, path: string): Promise<string[]> {
  const segments = path.split("/").filter(Boolean);
  const created: string[] = [];

  let current = "";
  for (const seg of segments) {
    current += `/${seg}`;
    if (await exists(auth, current)) continue;
    await mkcol(auth, current);
    created.push(current);
  }

  return created;
}

/** DELETE — delete file or folder */
export async function deleteResource(auth: WebDavAuth, path: string): Promise<void> {
  const res = await fetch(fullUrl(path), {
    method: "DELETE",
    headers: {
      Authorization: authHeader(auth),
      Accept: "*/*",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`DELETE ${path} failed: ${res.status} ${res.statusText}`);
  }
}

/** MOVE — move or rename */
export async function move(
  auth: WebDavAuth,
  from: string,
  to: string,
  overwrite = false,
): Promise<void> {
  const res = await fetch(fullUrl(from), {
    method: "MOVE",
    headers: {
      Authorization: authHeader(auth),
      Destination: fullUrl(to),
      Overwrite: overwrite ? "T" : "F",
      Accept: "*/*",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`MOVE ${from} -> ${to} failed: ${res.status} ${res.statusText}`);
  }
}

/** COPY — copy resource */
export async function copy(
  auth: WebDavAuth,
  from: string,
  to: string,
  overwrite = false,
): Promise<void> {
  const res = await fetch(fullUrl(from), {
    method: "COPY",
    headers: {
      Authorization: authHeader(auth),
      Destination: fullUrl(to),
      Overwrite: overwrite ? "T" : "F",
      Accept: "*/*",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`COPY ${from} -> ${to} failed: ${res.status} ${res.statusText}`);
  }
}

/** PROPPATCH — publish resource and get public URL */
export async function publish(auth: WebDavAuth, path: string): Promise<string> {
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<propertyupdate xmlns="DAV:">
  <set><prop>
    <public_url xmlns="urn:yandex:disk:meta">true</public_url>
  </prop></set>
</propertyupdate>`;

  const res = await fetch(fullUrl(path), {
    method: "PROPPATCH",
    headers: {
      Authorization: authHeader(auth),
      "Content-Type": "application/xml",
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok && res.status !== 207) {
    throw new Error(`PROPPATCH publish ${path} failed: ${res.status} ${res.statusText}`);
  }

  const xml = await res.text();
  const urlMatch = extractTag(xml, "public_url");
  return urlMatch || "(published, but URL not returned — check Yandex.Disk UI)";
}

/** PROPPATCH — unpublish resource */
export async function unpublish(auth: WebDavAuth, path: string): Promise<void> {
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<propertyupdate xmlns="DAV:">
  <remove><prop>
    <public_url xmlns="urn:yandex:disk:meta"/>
  </prop></remove>
</propertyupdate>`;

  const res = await fetch(fullUrl(path), {
    method: "PROPPATCH",
    headers: {
      Authorization: authHeader(auth),
      "Content-Type": "application/xml",
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok && res.status !== 207) {
    throw new Error(`PROPPATCH unpublish ${path} failed: ${res.status} ${res.statusText}`);
  }
}
