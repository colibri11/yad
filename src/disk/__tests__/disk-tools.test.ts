import { beforeEach, describe, expect, it, vi } from "vitest";
import type { YandexPluginConfig } from "../../common/types.js";

vi.mock("../../common/webdav.js", () => ({
  propfind: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
  mkcol: vi.fn(),
  deleteResource: vi.fn(),
  move: vi.fn(),
  copy: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
}));

import * as webdav from "../../common/webdav.js";
import { createDiskTools } from "../disk-tools.js";

const config: YandexPluginConfig = {
  login: "user",
  disk_app_password: "disk-secret",
};

function findTool(name: string) {
  const tools = createDiskTools(config);
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("yad_disk_list", () => {
  it("calls propfind and skips first entry (self)", async () => {
    vi.mocked(webdav.propfind).mockResolvedValue([
      {
        href: "/",
        displayName: "disk",
        isCollection: true,
        contentLength: 0,
        contentType: "",
        lastModified: "",
        creationDate: "",
      },
      {
        href: "/docs/",
        displayName: "docs",
        isCollection: true,
        contentLength: 0,
        contentType: "",
        lastModified: "Mon, 01 Apr 2026",
        creationDate: "",
      },
      {
        href: "/file.txt",
        displayName: "file.txt",
        isCollection: false,
        contentLength: 100,
        contentType: "text/plain",
        lastModified: "Tue, 02 Apr 2026",
        creationDate: "",
      },
    ]);

    const tool = findTool("yad_disk_list");
    const result = await tool.execute("id", { path: "/" });
    const items = JSON.parse(result.content[0].text);

    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("docs");
    expect(items[0].type).toBe("folder");
    expect(items[1].name).toBe("file.txt");
    expect(items[1].type).toBe("file");
    expect(items[1].size).toBe(100);
  });
});

describe("yad_disk_info", () => {
  it("calls propfind with depth 0", async () => {
    vi.mocked(webdav.propfind).mockResolvedValue([
      {
        href: "/file.txt",
        displayName: "file.txt",
        isCollection: false,
        contentLength: 256,
        contentType: "text/plain",
        lastModified: "Wed, 03 Apr 2026",
        creationDate: "2026-01-01",
      },
    ]);

    const tool = findTool("yad_disk_info");
    const result = await tool.execute("id", { path: "/file.txt" });
    const info = JSON.parse(result.content[0].text);

    expect(info.name).toBe("file.txt");
    expect(info.type).toBe("file");
    expect(info.size).toBe(256);
    expect(webdav.propfind).toHaveBeenCalledWith(
      expect.objectContaining({ login: "user@yandex.ru" }),
      "/file.txt",
      "0",
    );
  });

  it("throws when resource not found", async () => {
    vi.mocked(webdav.propfind).mockResolvedValue([]);

    const tool = findTool("yad_disk_info");
    await expect(tool.execute("id", { path: "/missing" })).rejects.toThrow("Resource not found");
  });
});

describe("yad_disk_download", () => {
  it("returns text for text files", async () => {
    vi.mocked(webdav.download).mockResolvedValue(Buffer.from("Hello, world!"));

    const tool = findTool("yad_disk_download");
    const result = await tool.execute("id", { path: "/readme.txt" });

    expect(result.content[0].text).toBe("Hello, world!");
  });

  it("returns base64 for binary files", async () => {
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a]);
    vi.mocked(webdav.download).mockResolvedValue(binary);

    const tool = findTool("yad_disk_download");
    const result = await tool.execute("id", { path: "/image.png" });

    expect(result.content[0].text).toContain("[Binary file");
    expect(result.content[0].text).toContain("base64");
  });
});

describe("yad_disk_upload", () => {
  it("uploads text content as UTF-8", async () => {
    vi.mocked(webdav.upload).mockResolvedValue(undefined);

    const tool = findTool("yad_disk_upload");
    const result = await tool.execute("id", {
      path: "/notes.txt",
      content: "my notes",
      content_type: "text/plain",
    });

    expect(webdav.upload).toHaveBeenCalledWith(
      expect.objectContaining({ login: "user@yandex.ru" }),
      "/notes.txt",
      Buffer.from("my notes", "utf-8"),
      "text/plain",
    );
    expect(result.content[0].text).toContain("/notes.txt");
  });

  it("uploads base64 content as binary", async () => {
    vi.mocked(webdav.upload).mockResolvedValue(undefined);
    const b64 = Buffer.from("binary data here").toString("base64");

    const tool = findTool("yad_disk_upload");
    const result = await tool.execute("id", {
      path: "/image.png",
      content: b64,
      encoding: "base64",
    });

    expect(webdav.upload).toHaveBeenCalledWith(
      expect.objectContaining({ login: "user@yandex.ru" }),
      "/image.png",
      Buffer.from(b64, "base64"),
      "application/octet-stream",
    );
    expect(result.content[0].text).toContain("/image.png");
  });

  it("uploads from local file via source_path", async () => {
    vi.mocked(webdav.upload).mockResolvedValue(undefined);
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");

    const tmpFile = path.join(os.tmpdir(), `yad-test-${Date.now()}.bin`);
    const fileContent = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header
    fs.writeFileSync(tmpFile, fileContent);

    try {
      const tool = findTool("yad_disk_upload");
      const result = await tool.execute("id", {
        path: "/photo.png",
        source_path: tmpFile,
        content_type: "image/png",
      });

      expect(webdav.upload).toHaveBeenCalledWith(
        expect.objectContaining({ login: "user@yandex.ru" }),
        "/photo.png",
        fileContent,
        "image/png",
      );
      expect(result.content[0].text).toContain("/photo.png");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it("defaults content_type to text/plain for text, octet-stream for binary", async () => {
    vi.mocked(webdav.upload).mockResolvedValue(undefined);

    const tool = findTool("yad_disk_upload");

    await tool.execute("id", { path: "/a.txt", content: "hello" });
    expect(webdav.upload).toHaveBeenLastCalledWith(
      expect.anything(),
      "/a.txt",
      expect.any(Buffer),
      "text/plain",
    );

    await tool.execute("id", {
      path: "/b.bin",
      content: Buffer.from("data").toString("base64"),
      encoding: "base64",
    });
    expect(webdav.upload).toHaveBeenLastCalledWith(
      expect.anything(),
      "/b.bin",
      expect.any(Buffer),
      "application/octet-stream",
    );
  });

  it("throws when neither content nor source_path provided", async () => {
    const tool = findTool("yad_disk_upload");
    await expect(tool.execute("id", { path: "/fail.txt" })).rejects.toThrow(
      "Provide either content or source_path",
    );
  });

  it("throws when source_path does not exist", async () => {
    const tool = findTool("yad_disk_upload");
    await expect(
      tool.execute("id", { path: "/fail.txt", source_path: "/nonexistent/file.bin" }),
    ).rejects.toThrow("File not found");
  });
});

describe("yad_disk_mkdir", () => {
  it("calls mkcol", async () => {
    vi.mocked(webdav.mkcol).mockResolvedValue(undefined);

    const tool = findTool("yad_disk_mkdir");
    await tool.execute("id", { path: "/new-folder" });

    expect(webdav.mkcol).toHaveBeenCalledWith(
      expect.objectContaining({ login: "user@yandex.ru" }),
      "/new-folder",
    );
  });
});

describe("yad_disk_delete", () => {
  it("calls deleteResource", async () => {
    vi.mocked(webdav.deleteResource).mockResolvedValue(undefined);

    const tool = findTool("yad_disk_delete");
    await tool.execute("id", { path: "/old.txt" });

    expect(webdav.deleteResource).toHaveBeenCalledWith(
      expect.objectContaining({ login: "user@yandex.ru" }),
      "/old.txt",
    );
  });
});

describe("yad_disk_move", () => {
  it("calls move with overwrite=false by default", async () => {
    vi.mocked(webdav.move).mockResolvedValue(undefined);

    const tool = findTool("yad_disk_move");
    await tool.execute("id", { from: "/a.txt", to: "/b.txt" });

    expect(webdav.move).toHaveBeenCalledWith(expect.anything(), "/a.txt", "/b.txt", false);
  });

  it("passes overwrite=true when specified", async () => {
    vi.mocked(webdav.move).mockResolvedValue(undefined);

    const tool = findTool("yad_disk_move");
    await tool.execute("id", { from: "/a.txt", to: "/b.txt", overwrite: true });

    expect(webdav.move).toHaveBeenCalledWith(expect.anything(), "/a.txt", "/b.txt", true);
  });
});

describe("yad_disk_copy", () => {
  it("calls copy", async () => {
    vi.mocked(webdav.copy).mockResolvedValue(undefined);

    const tool = findTool("yad_disk_copy");
    await tool.execute("id", { from: "/src.txt", to: "/dst.txt" });

    expect(webdav.copy).toHaveBeenCalledWith(expect.anything(), "/src.txt", "/dst.txt", false);
  });
});

describe("yad_disk_publish", () => {
  it("publishes and returns URL", async () => {
    vi.mocked(webdav.publish).mockResolvedValue("https://yadi.sk/d/abc123");

    const tool = findTool("yad_disk_publish");
    const result = await tool.execute("id", { path: "/shared.pdf" });

    expect(result.content[0].text).toContain("https://yadi.sk/d/abc123");
    expect(webdav.publish).toHaveBeenCalled();
  });

  it("unpublishes when flag is set", async () => {
    vi.mocked(webdav.unpublish).mockResolvedValue(undefined);

    const tool = findTool("yad_disk_publish");
    const result = await tool.execute("id", { path: "/shared.pdf", unpublish: true });

    expect(result.content[0].text).toContain("Unpublished");
    expect(webdav.unpublish).toHaveBeenCalled();
  });
});
