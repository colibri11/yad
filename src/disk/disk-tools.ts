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
      name: "yandex_disk_list",
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
      name: "yandex_disk_info",
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
      name: "yandex_disk_download",
      description:
        "Download a file from Yandex.Disk. Returns the file content as text " +
        "(for text files) or base64 (for binary files).",
      parameters: Type.Object(
        {
          path: Type.String({ description: "Path to the file to download" }),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { path: string }) {
        const buf = await webdav.download(auth(), params.path);
        // Try to detect if text
        const isText = isLikelyText(buf);
        if (isText) {
          return textResult(buf.toString("utf-8"));
        }
        return textResult(`[Binary file, ${buf.length} bytes, base64]:\n${buf.toString("base64")}`);
      },
    },
    {
      name: "yandex_disk_upload",
      description: "Upload a text file to Yandex.Disk.",
      parameters: Type.Object(
        {
          path: Type.String({ description: "Destination path, e.g. /Documents/notes.txt" }),
          content: Type.String({ description: "File content (text)" }),
          content_type: Type.Optional(
            Type.String({
              description: "MIME type, defaults to text/plain",
              default: "text/plain",
            }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { path: string; content: string; content_type?: string }) {
        await webdav.upload(
          auth(),
          params.path,
          Buffer.from(params.content, "utf-8"),
          params.content_type || "text/plain",
        );
        return textResult(`Uploaded to ${params.path}`);
      },
    },
    {
      name: "yandex_disk_mkdir",
      description: "Create a folder in Yandex.Disk.",
      parameters: Type.Object(
        {
          path: Type.String({ description: "Path for the new folder, e.g. /Projects/new-folder" }),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { path: string }) {
        await webdav.mkcol(auth(), params.path);
        return textResult(`Folder created: ${params.path}`);
      },
    },
    {
      name: "yandex_disk_delete",
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
      name: "yandex_disk_move",
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
      name: "yandex_disk_copy",
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
      name: "yandex_disk_publish",
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
