import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { YandexPluginConfig } from "../../common/types.js";

const { imapCtor, smtpSet, createTransport } = vi.hoisted(() => ({
  imapCtor: vi.fn(),
  smtpSet: vi.fn(),
  createTransport: vi.fn(),
}));

vi.mock("imapflow", () => ({
  ImapFlow: vi.fn(function (this: unknown, opts: unknown) {
    imapCtor(opts);
    return {
      options: opts,
      connect: vi.fn().mockResolvedValue(undefined),
      mailboxOpen: vi.fn().mockResolvedValue(undefined),
      idle: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };
  }),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn().mockImplementation((opts: unknown) => {
      createTransport(opts);
      return { options: opts, set: smtpSet };
    }),
  },
}));

import { createImapClient, createSmtpTransport } from "../clients.js";
import { startIdleWatcher } from "../idle-watcher.js";

const config: YandexPluginConfig = { login: "user", mail_app_password: "secret" };

const PROXY_KEYS = [
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
  vi.clearAllMocks();
  saved = {};
  for (const k of PROXY_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of PROXY_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("createImapClient", () => {
  it("constructs without a proxy option when no proxy env is set", () => {
    createImapClient(config);
    const opts = imapCtor.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.proxy).toBeUndefined();
    expect(opts.host).toBe("imap.yandex.ru");
  });

  it("passes the proxy URL when HTTPS_PROXY is set", () => {
    process.env.HTTPS_PROXY = "http://proxy.internal:3128";
    createImapClient(config);
    const opts = imapCtor.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.proxy).toBe("http://proxy.internal:3128");
  });

  it("merges extra options (e.g. maxIdleTime for the IDLE watcher)", () => {
    process.env.HTTPS_PROXY = "http://proxy.internal:3128";
    createImapClient(config, { maxIdleTime: 1234 });
    const opts = imapCtor.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.proxy).toBe("http://proxy.internal:3128");
    expect(opts.maxIdleTime).toBe(1234);
  });
});

describe("createSmtpTransport", () => {
  it("omits proxy when no proxy env is set", () => {
    createSmtpTransport(config);
    const opts = createTransport.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.proxy).toBeUndefined();
    expect(smtpSet).not.toHaveBeenCalled();
  });

  it("passes an http proxy without registering the socks module", () => {
    process.env.HTTPS_PROXY = "http://proxy.internal:3128";
    createSmtpTransport(config);
    const opts = createTransport.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.proxy).toBe("http://proxy.internal:3128");
    expect(smtpSet).not.toHaveBeenCalled();
  });

  it("registers the socks module for a socks proxy", () => {
    process.env.HTTPS_PROXY = "socks5://proxy.internal:1080";
    createSmtpTransport(config);
    const opts = createTransport.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.proxy).toBe("socks5://proxy.internal:1080");
    expect(smtpSet).toHaveBeenCalledWith("proxy_socks_module", expect.anything());
  });
});

describe("IDLE watcher", () => {
  it("creates its IMAP client through the shared proxy-aware factory", async () => {
    process.env.HTTPS_PROXY = "http://proxy.internal:3128";
    const handle = startIdleWatcher({
      config,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      folder: "INBOX",
      notifyAgent: async () => {},
    });
    // connect() runs on the next tick; let it construct the client.
    await new Promise((r) => setTimeout(r, 0));
    expect(imapCtor).toHaveBeenCalled();
    const opts = imapCtor.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.proxy).toBe("http://proxy.internal:3128");
    expect(opts.maxIdleTime).toBe(5 * 60 * 1000);
    await handle.stop();
  });
});
