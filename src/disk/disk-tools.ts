import { Type } from "@sinclair/typebox";
import type { YandexPluginConfig } from "../common/types.js";
import {
  isLikelyText,
  jsonResult,
  requirePassword,
  resolveLogin,
  textResult,
} from "../common/types.js";
import * as webdav from "../common/webdav.js";
import * as rest from "./rest-api.js";

/** Yandex's WebDAV gateway reliably handles only small bodies. Above this
 * threshold we either route through the REST API (if OAuth token is set) or
 * fail with a clear message. Empirically connections die around 20–30 MB. */
const WEBDAV_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;

function diskAuth(config: YandexPluginConfig): webdav.WebDavAuth {
  return {
    login: resolveLogin(config.login),
    password: requirePassword(config, "disk"),
  };
}

export function createDiskTools(config: YandexPluginConfig) {
  const auth = () => diskAuth(config);

  return [
    {
      name: "yad_disk_list",
      description:
        "List files and folders in Yandex.Disk at a given path. " +
        "Returns name, type (file/folder), size, and last modified date.",
      parameters: Type.Object(
        {
          path: Type.String({
            description: 'Path in Yandex.Disk, e.g. "/" or "/Documents"',
            default: "/",
          }),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { path: string }) {
        const resources = await webdav.propfind(auth(), params.path || "/", "1");
        // First entry is the folder itself — skip it
        const items = resources.slice(1).map((r) => ({
          name: r.displayName || r.href.split("/").filter(Boolean).pop() || r.href,
          type: r.isCollection ? "folder" : "file",
          size: r.isCollection ? undefined : r.contentLength,
          contentType: r.isCollection ? undefined : r.contentType,
          lastModified: r.lastModified,
          href: r.href,
        }));
        return jsonResult(items);
      },
    },
    {
      name: "yad_disk_info",
      description: "Get properties of a specific file or folder in Yandex.Disk.",
      parameters: Type.Object(
        {
          path: Type.String({ description: "Path to the resource" }),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { path: string }) {
        const resources = await webdav.propfind(auth(), params.path, "0");
        if (resources.length === 0) throw new Error(`Resource not found: ${params.path}`);
        const r = resources[0];
        return jsonResult({
          name: r.displayName || r.href,
          type: r.isCollection ? "folder" : "file",
          size: r.contentLength,
          contentType: r.contentType,
          lastModified: r.lastModified,
          creationDate: r.creationDate,
        });
      },
    },
    {
      name: "yad_disk_download",
      description:
        "Download a file from Yandex.Disk. Two modes:\n" +
        "1. In-context (default, no target_path): text files return raw text as a string; binary files return a line " +
        "'[Binary file, N bytes, base64]:' followed by the base64-encoded content on the next line. " +
        "Parse the base64 payload after the colon+newline to get the original bytes.\n" +
        "2. To local file (target_path set): streams the file directly to the given absolute local path without " +
        "loading the content into the response. Returns JSON metadata {target_path, bytes, content_type}. " +
        "Parent directories are created automatically. Fails if the target already exists unless overwrite=true.\n" +
        "ALWAYS use target_path when the file is known or likely to be binary (images, PDFs, archives, media) or large — " +
        "base64 payloads expand the context rapidly and waste tokens. Prefer delegating in-context downloads to a subagent " +
        "so results don't pollute the main context.",
      parameters: Type.Object(
        {
          path: Type.String({ description: "Path to the file to download" }),
          target_path: Type.Optional(
            Type.String({
              description:
                "Absolute local filesystem path to stream the file to. When set, content is NOT returned in the response.",
            }),
          ),
          overwrite: Type.Optional(
            Type.Boolean({
              description: "Overwrite target_path if it already exists (default: false)",
            }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(
        _id: string,
        params: { path: string; target_path?: string; overwrite?: boolean },
      ) {
        const useRest = Boolean(config.disk_oauth_token);

        if (params.target_path) {
          const fs = await import("node:fs");
          const pathMod = await import("node:path");
          if (!pathMod.isAbsolute(params.target_path)) {
            throw new Error(`target_path must be absolute: ${params.target_path}`);
          }
          if (fs.existsSync(params.target_path) && !params.overwrite) {
            throw new Error(
              `target_path already exists: ${params.target_path} (pass overwrite=true to replace)`,
            );
          }
          fs.mkdirSync(pathMod.dirname(params.target_path), { recursive: true });

          const { bytes, contentType } = useRest
            ? await rest.restDownloadToFile(
                config.disk_oauth_token as string,
                params.path,
                params.target_path,
              )
            : await webdav.downloadToFile(auth(), params.path, params.target_path);

          return jsonResult({
            target_path: params.target_path,
            bytes,
            content_type: contentType,
            transport: useRest ? "rest" : "webdav",
          });
        }

        const buf = useRest
          ? await rest.restDownloadBuffer(config.disk_oauth_token as string, params.path)
          : await webdav.download(auth(), params.path);
        const isText = isLikelyText(buf);
        if (isText) {
          return textResult(buf.toString("utf-8"));
        }
        return textResult(`[Binary file, ${buf.length} bytes, base64]:\n${buf.toString("base64")}`);
      },
    },
    {
      name: "yad_disk_upload",
      description:
        "Upload a file to Yandex.Disk. Three modes:\n" +
        "1. Text: provide content (string). Encoded as UTF-8.\n" +
        "2. Binary: provide content (base64 string) + encoding='base64'. Decoded before upload.\n" +
        "3. Local file: provide source_path (absolute path). File is read from disk.\n" +
        "Use content OR source_path, not both.\n" +
        "Transport: files ≤ 10 MB go via WebDAV (uses app password). Larger files require an OAuth token " +
        "(disk_oauth_token in config) and are routed via the Yandex.Disk REST API CDN — without it, large " +
        "uploads will fail because Yandex's WebDAV gateway throttles connections at ~20–30 MB.\n" +
        "For large files, consider delegating this call to a subagent — upload may take significant time " +
        "depending on file size and network conditions.",
      parameters: Type.Object(
        {
          path: Type.String({ description: "Destination path, e.g. /Documents/report.pdf" }),
          content: Type.Optional(
            Type.String({ description: "File content: plain text or base64-encoded binary" }),
          ),
          encoding: Type.Optional(
            Type.String({
              description: "Content encoding: 'base64' for binary data. Omit for plain text.",
            }),
          ),
          source_path: Type.Optional(
            Type.String({
              description: "Absolute path to a local file to upload. Alternative to content.",
            }),
          ),
          content_type: Type.Optional(
            Type.String({
              description:
                "MIME type, defaults to text/plain for text or application/octet-stream for binary/file",
            }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(
        _id: string,
        params: {
          path: string;
          content?: string;
          encoding?: string;
          source_path?: string;
          content_type?: string;
        },
      ) {
        let buf: Buffer;
        let defaultContentType: string;

        if (params.source_path) {
          const fs = await import("node:fs");
          if (!fs.existsSync(params.source_path)) {
            throw new Error(`File not found: ${params.source_path}`);
          }
          const size = fs.statSync(params.source_path).size;
          const useRest = size > WEBDAV_UPLOAD_LIMIT_BYTES;

          if (useRest && !config.disk_oauth_token) {
            throw new Error(
              `File ${params.source_path} is ${size} bytes — exceeds Yandex WebDAV's ~10 MB safe limit. ` +
                "Set disk_oauth_token in plugin config (or YANDEX_DISK_OAUTH_TOKEN env var) to enable " +
                "REST API uploads for large files. Get a token at https://oauth.yandex.ru/.",
            );
          }

          if (useRest) {
            const { bytes } = await rest.restUploadFile(
              config.disk_oauth_token as string,
              params.path,
              params.source_path,
              true,
            );
            return textResult(`Uploaded to ${params.path} (${bytes} bytes, transport: rest)`);
          }

          // Stream via WebDAV — fits in the gateway's tolerance window.
          const { bytes } = await webdav.uploadFromFile(
            auth(),
            params.path,
            params.source_path,
            params.content_type || "application/octet-stream",
          );
          return textResult(`Uploaded to ${params.path} (${bytes} bytes, transport: webdav)`);
        }
        if (params.content != null) {
          if (params.encoding === "base64") {
            buf = Buffer.from(params.content, "base64");
            defaultContentType = "application/octet-stream";
          } else {
            buf = Buffer.from(params.content, "utf-8");
            defaultContentType = "text/plain";
          }
        } else {
          throw new Error("Provide either content or source_path");
        }

        if (buf.length > WEBDAV_UPLOAD_LIMIT_BYTES) {
          if (!config.disk_oauth_token) {
            throw new Error(
              `Inline content is ${buf.length} bytes — exceeds Yandex WebDAV's ~10 MB safe limit. ` +
                "For large uploads, use source_path with a local file AND set disk_oauth_token in config " +
                "(or YANDEX_DISK_OAUTH_TOKEN env var). Get a token at https://oauth.yandex.ru/.",
            );
          }
          // Spill the buffer to a temp file and route via REST.
          const fs = await import("node:fs");
          const os = await import("node:os");
          const pathMod = await import("node:path");
          const tmpPath = pathMod.join(os.tmpdir(), `yad-upload-${Date.now()}-${process.pid}`);
          fs.writeFileSync(tmpPath, buf);
          try {
            const { bytes } = await rest.restUploadFile(
              config.disk_oauth_token,
              params.path,
              tmpPath,
              true,
            );
            return textResult(`Uploaded to ${params.path} (${bytes} bytes, transport: rest)`);
          } finally {
            try {
              fs.unlinkSync(tmpPath);
            } catch {}
          }
        }

        await webdav.upload(auth(), params.path, buf, params.content_type || defaultContentType);
        return textResult(`Uploaded to ${params.path} (${buf.length} bytes, transport: webdav)`);
      },
    },
    {
      name: "yad_disk_mkdir",
      description:
        "Create a folder in Yandex.Disk. " +
        "Set recursive=true to create all missing parent folders (like mkdir -p). " +
        "Without recursive, the parent folder must already exist or the call will fail with 409 Conflict.",
      parameters: Type.Object(
        {
          path: Type.String({ description: "Path for the new folder, e.g. /Projects/new-folder" }),
          recursive: Type.Optional(
            Type.Boolean({
              description: "Create parent folders if they don't exist (default: false)",
            }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { path: string; recursive?: boolean }) {
        if (params.recursive) {
          const created = await webdav.mkcolRecursive(auth(), params.path);
          if (created.length === 0) {
            return textResult(`Folder already exists: ${params.path}`);
          }
          return textResult(`Folders created: ${created.join(", ")}`);
        }
        await webdav.mkcol(auth(), params.path);
        return textResult(`Folder created: ${params.path}`);
      },
    },
    {
      name: "yad_disk_delete",
      description: "Delete a file or folder in Yandex.Disk. Folders are deleted recursively.",
      parameters: Type.Object(
        {
          path: Type.String({ description: "Path to delete" }),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { path: string }) {
        await webdav.deleteResource(auth(), params.path);
        return textResult(`Deleted: ${params.path}`);
      },
    },
    {
      name: "yad_disk_move",
      description: "Move or rename a file/folder in Yandex.Disk.",
      parameters: Type.Object(
        {
          from: Type.String({ description: "Source path" }),
          to: Type.String({ description: "Destination path" }),
          overwrite: Type.Optional(
            Type.Boolean({ description: "Overwrite if exists", default: false }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { from: string; to: string; overwrite?: boolean }) {
        await webdav.move(auth(), params.from, params.to, params.overwrite ?? false);
        return textResult(`Moved ${params.from} -> ${params.to}`);
      },
    },
    {
      name: "yad_disk_copy",
      description: "Copy a file or folder in Yandex.Disk.",
      parameters: Type.Object(
        {
          from: Type.String({ description: "Source path" }),
          to: Type.String({ description: "Destination path" }),
          overwrite: Type.Optional(
            Type.Boolean({ description: "Overwrite if exists", default: false }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { from: string; to: string; overwrite?: boolean }) {
        await webdav.copy(auth(), params.from, params.to, params.overwrite ?? false);
        return textResult(`Copied ${params.from} -> ${params.to}`);
      },
    },
    {
      name: "yad_disk_publish",
      description:
        "Publish a file or folder in Yandex.Disk and get a public link, " +
        "or unpublish it to remove public access.",
      parameters: Type.Object(
        {
          path: Type.String({ description: "Path to the resource" }),
          unpublish: Type.Optional(
            Type.Boolean({ description: "Set to true to unpublish", default: false }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { path: string; unpublish?: boolean }) {
        if (params.unpublish) {
          await webdav.unpublish(auth(), params.path);
          return textResult(`Unpublished: ${params.path}`);
        }
        const url = await webdav.publish(auth(), params.path);
        return textResult(`Published: ${params.path}\nPublic URL: ${url}`);
      },
    },
  ];
}
