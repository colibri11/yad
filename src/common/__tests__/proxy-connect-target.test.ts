import { describe, expect, it, vi } from "vitest";

// imapflow pre-resolves via dns.resolve; mock it so the test is deterministic & offline.
vi.mock("node:dns/promises", () => ({
  default: { resolve: vi.fn(async () => ["192.0.2.10"]) },
}));

import { connectTargetFor } from "../proxy.js";

describe("connectTargetFor — replicates the real client's CONNECT target", () => {
  it("hostname transports (SMTP/nodemailer, DAV/undici) CONNECT by hostname, no DNS resolve", async () => {
    expect(await connectTargetFor({ name: "SMTP", host: "smtp.yandex.ru", port: 465 })).toEqual({
      host: "smtp.yandex.ru",
      via: "hostname",
    });
    expect(await connectTargetFor({ name: "WebDAV", host: "webdav.yandex.ru", port: 443 })).toEqual(
      { host: "webdav.yandex.ru", via: "hostname" },
    );
  });

  it("connectByIp transports (IMAP/imapflow) resolve the hostname to an IP", async () => {
    const r = await connectTargetFor({
      name: "IMAP",
      host: "imap.yandex.ru",
      port: 993,
      connectByIp: true,
    });
    expect(r).toEqual({ host: "192.0.2.10", via: "ip" });
  });

  it("connectByIp with an IP literal does not re-resolve", async () => {
    expect(
      await connectTargetFor({ name: "IMAP", host: "10.0.0.5", port: 993, connectByIp: true }),
    ).toEqual({ host: "10.0.0.5", via: "ip" });
  });
});
