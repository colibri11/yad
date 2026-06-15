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
/** Upload a local file via REST API (two-step: get URL, then PUT). */
export declare function restUploadFile(
  token: string,
  remotePath: string,
  localPath: string,
  overwrite?: boolean,
): Promise<{
  bytes: number;
}>;
/** Download a remote file via REST API to a local path (streaming). */
export declare function restDownloadToFile(
  token: string,
  remotePath: string,
  localPath: string,
): Promise<{
  bytes: number;
  contentType: string;
}>;
/** Download a remote file via REST API into memory (for small in-context usage). */
export declare function restDownloadBuffer(token: string, remotePath: string): Promise<Buffer>;
