import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getDispatcher,
  getHttpsAgent,
  maskProxy,
  proxyReport,
  proxySummary,
  resolveProxy,
} from "../proxy.js";

const PROXY_ENV_KEYS = [
  "YAD_PROXY_URL",
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of PROXY_ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of PROXY_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("resolveProxy", () => {
  it("returns undefined when no proxy env is set (no regression for direct mode)", () => {
    expect(resolveProxy("imap.yandex.ru")).toBeUndefined();
    expect(resolveProxy()).toBeUndefined();
  });

  it("reads HTTPS_PROXY", () => {
    process.env.HTTPS_PROXY = "http://proxy.internal:3128";
    expect(resolveProxy("webdav.yandex.ru")).toBe("http://proxy.internal:3128");
  });

  it("falls back to lowercase https_proxy", () => {
    process.env.https_proxy = "http://proxy.internal:3128";
    expect(resolveProxy("imap.yandex.ru")).toBe("http://proxy.internal:3128");
  });

  it("falls back to ALL_PROXY then HTTP_PROXY", () => {
    process.env.HTTP_PROXY = "http://http-proxy:8080";
    expect(resolveProxy("imap.yandex.ru")).toBe("http://http-proxy:8080");
    process.env.ALL_PROXY = "socks5://socks-proxy:1080";
    expect(resolveProxy("imap.yandex.ru")).toBe("socks5://socks-proxy:1080");
  });

  it("honours YAD_PROXY_URL override with highest precedence", () => {
    process.env.HTTPS_PROXY = "http://env-proxy:3128";
    process.env.YAD_PROXY_URL = "http://override:9000";
    expect(resolveProxy("imap.yandex.ru")).toBe("http://override:9000");
  });

  it("normalizes a scheme-less proxy to http://", () => {
    process.env.HTTPS_PROXY = "proxy.internal:3128";
    expect(resolveProxy("imap.yandex.ru")).toBe("http://proxy.internal:3128");
  });

  describe("NO_PROXY", () => {
    beforeEach(() => {
      process.env.HTTPS_PROXY = "http://proxy.internal:3128";
    });

    it("bypasses an exact host match", () => {
      process.env.NO_PROXY = "imap.yandex.ru";
      expect(resolveProxy("imap.yandex.ru")).toBeUndefined();
      expect(resolveProxy("smtp.yandex.ru")).toBe("http://proxy.internal:3128");
    });

    it("bypasses a suffix / leading-dot match", () => {
      process.env.NO_PROXY = ".yandex.ru";
      expect(resolveProxy("imap.yandex.ru")).toBeUndefined();
      expect(resolveProxy("example.com")).toBe("http://proxy.internal:3128");
    });

    it("bypasses bare-domain suffix and *.domain wildcard", () => {
      process.env.NO_PROXY = "yandex.ru";
      expect(resolveProxy("caldav.yandex.ru")).toBeUndefined();
      process.env.NO_PROXY = "*.yandex.ru";
      expect(resolveProxy("caldav.yandex.ru")).toBeUndefined();
    });

    it("bypasses everything with *", () => {
      process.env.NO_PROXY = "*";
      expect(resolveProxy("imap.yandex.ru")).toBeUndefined();
    });
  });
});

describe("maskProxy", () => {
  it("hides credentials", () => {
    expect(maskProxy("http://user:secret@proxy.internal:3128")).toBe(
      "http://***@proxy.internal:3128",
    );
  });
  it("keeps scheme/host/port when there are no credentials", () => {
    expect(maskProxy("socks5://proxy.internal:1080")).toBe("socks5://proxy.internal:1080");
  });
});

describe("getDispatcher / getHttpsAgent (DAV & Disk REST routing)", () => {
  it("returns undefined when no proxy is set (direct fetch / https)", () => {
    expect(getDispatcher("webdav.yandex.ru")).toBeUndefined();
    expect(getHttpsAgent("webdav.yandex.ru")).toBeUndefined();
  });

  it("returns an undici dispatcher for an http proxy", () => {
    process.env.HTTPS_PROXY = "http://proxy.internal:3128";
    expect(getDispatcher("cloud-api.yandex.ru")).toBeDefined();
    expect(getHttpsAgent("cloud-api.yandex.ru")).toBeDefined();
  });

  it("returns a dispatcher for a socks proxy", () => {
    process.env.HTTPS_PROXY = "socks5://proxy.internal:1080";
    expect(getDispatcher("webdav.yandex.ru")).toBeDefined();
  });

  it("does not route a NO_PROXY host", () => {
    process.env.HTTPS_PROXY = "http://proxy.internal:3128";
    process.env.NO_PROXY = "cloud-api.yandex.ru";
    expect(getDispatcher("cloud-api.yandex.ru")).toBeUndefined();
    expect(getHttpsAgent("cloud-api.yandex.ru")).toBeUndefined();
  });
});

describe("proxyReport / proxySummary", () => {
  it("reports direct for all transports without proxy env", () => {
    const report = proxyReport();
    expect(report.every((r) => r.proxy === null)).toBe(true);
    expect(proxySummary()).toContain("none");
  });

  it("reports the masked proxy per transport and respects NO_PROXY", () => {
    process.env.HTTPS_PROXY = "http://user:pw@proxy.internal:3128";
    process.env.NO_PROXY = "imap.yandex.ru";
    const report = proxyReport();
    const imap = report.find((r) => r.name === "IMAP");
    const dav = report.find((r) => r.name === "WebDAV (Disk)");
    expect(imap?.proxy).toBeNull();
    expect(dav?.proxy).toBe("http://***@proxy.internal:3128");
    const summary = proxySummary();
    expect(summary).toContain("http://***@proxy.internal:3128");
    expect(summary).not.toContain("pw");
  });
});
