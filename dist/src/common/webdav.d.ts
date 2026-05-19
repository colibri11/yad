/**
 * Lightweight WebDAV client for Yandex.Disk.
 * Uses native fetch — no extra dependencies.
 */
export interface WebDavAuth {
    login: string;
    password: string;
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
export declare function parseMultistatus(xml: string): DavResource[];
/** PROPFIND — list folder or get resource properties */
export declare function propfind(auth: WebDavAuth, path: string, depth?: "0" | "1"): Promise<DavResource[]>;
/** GET — download file, returns Buffer */
export declare function download(auth: WebDavAuth, path: string): Promise<Buffer>;
/** GET — stream file directly to local filesystem path. Returns bytes written and content type. */
export declare function downloadToFile(auth: WebDavAuth, remotePath: string, localPath: string): Promise<{
    bytes: number;
    contentType: string;
}>;
/** PUT — upload file */
export declare function upload(auth: WebDavAuth, path: string, body: Buffer | Uint8Array | string, contentType?: string): Promise<void>;
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
export declare function uploadFromFile(auth: WebDavAuth, remotePath: string, localPath: string, contentType?: string): Promise<{
    bytes: number;
}>;
/** Check if a resource exists (PROPFIND with Depth 0, returns false on 404) */
export declare function exists(auth: WebDavAuth, path: string): Promise<boolean>;
/** MKCOL — create folder */
export declare function mkcol(auth: WebDavAuth, path: string): Promise<void>;
/** MKCOL recursive — create folder and all missing parents (like mkdir -p) */
export declare function mkcolRecursive(auth: WebDavAuth, path: string): Promise<string[]>;
/** DELETE — delete file or folder */
export declare function deleteResource(auth: WebDavAuth, path: string): Promise<void>;
/** MOVE — move or rename */
export declare function move(auth: WebDavAuth, from: string, to: string, overwrite?: boolean): Promise<void>;
/** COPY — copy resource */
export declare function copy(auth: WebDavAuth, from: string, to: string, overwrite?: boolean): Promise<void>;
/** PROPPATCH — publish resource and get public URL */
export declare function publish(auth: WebDavAuth, path: string): Promise<string>;
/** PROPPATCH — unpublish resource */
export declare function unpublish(auth: WebDavAuth, path: string): Promise<void>;
