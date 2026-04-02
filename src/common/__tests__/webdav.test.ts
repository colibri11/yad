import { beforeEach, describe, expect, it, vi } from "vitest";
import * as webdav from "../webdav.js";
import { parseMultistatus } from "../webdav.js";

// Sample WebDAV PROPFIND response from Yandex.Disk
const MULTISTATUS_XML = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>disk</d:displayname>
        <d:resourcetype><d:collection/></d:resourcetype>
        <d:getlastmodified>Mon, 01 Apr 2026 10:00:00 GMT</d:getlastmodified>
        <d:creationdate>2025-01-01T00:00:00Z</d:creationdate>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/Documents/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Documents</d:displayname>
        <d:resourcetype><d:collection/></d:resourcetype>
        <d:getlastmodified>Tue, 02 Apr 2026 12:30:00 GMT</d:getlastmodified>
        <d:creationdate>2025-06-15T08:00:00Z</d:creationdate>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/readme.txt</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>readme.txt</d:displayname>
        <d:resourcetype/>
        <d:getcontentlength>1024</d:getcontentlength>
        <d:getcontenttype>text/plain</d:getcontenttype>
        <d:getlastmodified>Wed, 03 Apr 2026 09:15:00 GMT</d:getlastmodified>
        <d:creationdate>2026-03-20T14:00:00Z</d:creationdate>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

describe("parseMultistatus", () => {
  it("parses all response entries", () => {
    const resources = parseMultistatus(MULTISTATUS_XML);
    expect(resources).toHaveLength(3);
  });

  it("parses folder (collection) correctly", () => {
    const resources = parseMultistatus(MULTISTATUS_XML);
    const docs = resources[1];
    expect(docs.href).toBe("/Documents/");
    expect(docs.displayName).toBe("Documents");
    expect(docs.isCollection).toBe(true);
    expect(docs.lastModified).toBe("Tue, 02 Apr 2026 12:30:00 GMT");
  });

  it("parses file correctly", () => {
    const resources = parseMultistatus(MULTISTATUS_XML);
    const file = resources[2];
    expect(file.href).toBe("/readme.txt");
    expect(file.displayName).toBe("readme.txt");
    expect(file.isCollection).toBe(false);
    expect(file.contentLength).toBe(1024);
    expect(file.contentType).toBe("text/plain");
  });

  it("handles URL-encoded paths", () => {
    const xml = `<d:multistatus xmlns:d="DAV:">
      <d:response>
        <d:href>/%D0%A4%D0%BE%D1%82%D0%BE/</d:href>
        <d:propstat><d:prop>
          <d:displayname>Фото</d:displayname>
          <d:resourcetype><d:collection/></d:resourcetype>
        </d:prop></d:propstat>
      </d:response>
    </d:multistatus>`;
    const resources = parseMultistatus(xml);
    expect(resources[0].href).toBe("/Фото/");
    expect(resources[0].displayName).toBe("Фото");
  });

  it("returns empty array for empty multistatus", () => {
    const xml = `<d:multistatus xmlns:d="DAV:"></d:multistatus>`;
    expect(parseMultistatus(xml)).toEqual([]);
  });

  it("handles uppercase DAV namespace prefix", () => {
    const xml = `<D:multistatus xmlns:D="DAV:">
      <D:response>
        <D:href>/file.txt</D:href>
        <D:propstat><D:prop>
          <D:displayname>file.txt</D:displayname>
          <D:resourcetype/>
          <D:getcontentlength>512</D:getcontentlength>
          <D:getcontenttype>text/plain</D:getcontenttype>
        </D:prop></D:propstat>
      </D:response>
    </D:multistatus>`;
    const resources = parseMultistatus(xml);
    expect(resources).toHaveLength(1);
    expect(resources[0].displayName).toBe("file.txt");
    expect(resources[0].contentLength).toBe(512);
  });

  it("defaults contentLength to 0 when missing", () => {
    const xml = `<d:multistatus xmlns:d="DAV:">
      <d:response>
        <d:href>/folder/</d:href>
        <d:propstat><d:prop>
          <d:resourcetype><d:collection/></d:resourcetype>
        </d:prop></d:propstat>
      </d:response>
    </d:multistatus>`;
    const resources = parseMultistatus(xml);
    expect(resources[0].contentLength).toBe(0);
  });
});

describe("WebDAV client operations", () => {
  const auth: webdav.WebDavAuth = { login: "user@yandex.ru", password: "secret" };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("propfind sends correct method and headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 207,
      statusText: "Multi-Status",
      text: () => Promise.resolve(MULTISTATUS_XML),
    });
    vi.stubGlobal("fetch", mockFetch);

    await webdav.propfind(auth, "/Documents", "1");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://webdav.yandex.ru/Documents");
    expect(opts.method).toBe("PROPFIND");
    expect(opts.headers.Depth).toBe("1");
    expect(opts.headers.Authorization).toMatch(/^Basic /);
  });

  it("propfind with depth 0", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 207,
      statusText: "Multi-Status",
      text: () => Promise.resolve(MULTISTATUS_XML),
    });
    vi.stubGlobal("fetch", mockFetch);

    await webdav.propfind(auth, "/file.txt", "0");

    const opts = mockFetch.mock.calls[0][1];
    expect(opts.headers.Depth).toBe("0");
  });

  it("propfind throws on non-207 error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      }),
    );

    await expect(webdav.propfind(auth, "/missing")).rejects.toThrow(
      "PROPFIND /missing failed: 404",
    );
  });

  it("download returns Buffer", async () => {
    const data = new TextEncoder().encode("file content");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(data.buffer),
      }),
    );

    const buf = await webdav.download(auth, "/file.txt");
    expect(buf.toString("utf-8")).toBe("file content");
  });

  it("download throws on error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" }),
    );

    await expect(webdav.download(auth, "/missing.txt")).rejects.toThrow(
      "GET /missing.txt failed: 404",
    );
  });

  it("upload sends PUT with body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    await webdav.upload(auth, "/test.txt", Buffer.from("hello"), "text/plain");

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://webdav.yandex.ru/test.txt");
    expect(opts.method).toBe("PUT");
    expect(opts.headers["Content-Type"]).toBe("text/plain");
  });

  it("mkcol sends MKCOL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    await webdav.mkcol(auth, "/new-folder");

    expect(mockFetch.mock.calls[0][1].method).toBe("MKCOL");
  });

  it("deleteResource sends DELETE", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    await webdav.deleteResource(auth, "/old-file.txt");

    expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
  });

  it("move sends MOVE with Destination header", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    await webdav.move(auth, "/a.txt", "/b.txt", false);

    const opts = mockFetch.mock.calls[0][1];
    expect(opts.method).toBe("MOVE");
    expect(opts.headers.Destination).toBe("https://webdav.yandex.ru/b.txt");
    expect(opts.headers.Overwrite).toBe("F");
  });

  it("move with overwrite=true sets Overwrite: T", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    await webdav.move(auth, "/a.txt", "/b.txt", true);

    expect(mockFetch.mock.calls[0][1].headers.Overwrite).toBe("T");
  });

  it("copy sends COPY with Destination header", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    await webdav.copy(auth, "/a.txt", "/copy.txt", false);

    const opts = mockFetch.mock.calls[0][1];
    expect(opts.method).toBe("COPY");
    expect(opts.headers.Destination).toBe("https://webdav.yandex.ru/copy.txt");
  });

  it("publish sends PROPPATCH and returns public URL", async () => {
    const responseXml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:propstat><d:prop>
      <public_url xmlns="urn:yandex:disk:meta">https://yadi.sk/d/abc123</public_url>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 207,
        statusText: "Multi-Status",
        text: () => Promise.resolve(responseXml),
      }),
    );

    const url = await webdav.publish(auth, "/shared.pdf");
    expect(url).toBe("https://yadi.sk/d/abc123");
  });

  it("unpublish sends PROPPATCH remove", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 207,
      statusText: "Multi-Status",
      text: () => Promise.resolve("<d:multistatus xmlns:d='DAV:'/>"),
    });
    vi.stubGlobal("fetch", mockFetch);

    await webdav.unpublish(auth, "/shared.pdf");

    const body = mockFetch.mock.calls[0][1].body;
    expect(body).toContain("<remove>");
  });

  it("encodes path with spaces correctly", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 207,
      statusText: "Multi-Status",
      text: () => Promise.resolve("<d:multistatus xmlns:d='DAV:'/>"),
    });
    vi.stubGlobal("fetch", mockFetch);

    await webdav.propfind(auth, "/my folder/sub dir");

    const url = mockFetch.mock.calls[0][0];
    expect(url).toBe("https://webdav.yandex.ru/my%20folder/sub%20dir");
  });

  it("handles path without leading slash", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 207,
      statusText: "Multi-Status",
      text: () => Promise.resolve("<d:multistatus xmlns:d='DAV:'/>"),
    });
    vi.stubGlobal("fetch", mockFetch);

    await webdav.propfind(auth, "Documents");

    const url = mockFetch.mock.calls[0][0];
    expect(url).toBe("https://webdav.yandex.ru/Documents");
  });

  it("encodes # and ? in path segments", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 207,
      statusText: "Multi-Status",
      text: () => Promise.resolve("<d:multistatus xmlns:d='DAV:'/>"),
    });
    vi.stubGlobal("fetch", mockFetch);

    await webdav.propfind(auth, "/docs/file#1.txt");

    const url = mockFetch.mock.calls[0][0];
    expect(url).toBe("https://webdav.yandex.ru/docs/file%231.txt");
    expect(url).not.toContain("#");
  });

  it("encodes ? in filename", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 207,
      statusText: "Multi-Status",
      text: () => Promise.resolve("<d:multistatus xmlns:d='DAV:'/>"),
    });
    vi.stubGlobal("fetch", mockFetch);

    await webdav.propfind(auth, "/what?.txt");

    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain("%3F");
    expect(url).not.toContain("?");
  });

  it("auth header is correct Base64 encoding", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 207,
      statusText: "Multi-Status",
      text: () => Promise.resolve("<d:multistatus xmlns:d='DAV:'/>"),
    });
    vi.stubGlobal("fetch", mockFetch);

    await webdav.propfind(auth, "/");

    const authHeaderValue = mockFetch.mock.calls[0][1].headers.Authorization;
    const decoded = Buffer.from(authHeaderValue.replace("Basic ", ""), "base64").toString();
    expect(decoded).toBe("user@yandex.ru:secret");
  });
});
