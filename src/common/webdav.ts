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
