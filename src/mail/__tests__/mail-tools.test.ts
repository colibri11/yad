import { beforeEach, describe, expect, it, vi } from "vitest";
import type { YandexPluginConfig } from "../../common/types.js";

const {
  mockFetch,
  mockSearch,
  mockFetchOne,
  mockConnect,
  mockLogout,
  mockGetMailboxLock,
  mockRelease,
  mockSendMail,
} = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockSearch: vi.fn(),
  mockFetchOne: vi.fn(),
  mockConnect: vi.fn(),
  mockLogout: vi.fn(),
  mockGetMailboxLock: vi.fn(),
  mockRelease: vi.fn(),
  mockSendMail: vi.fn(),
}));

vi.mock("imapflow", () => {
  class MockImapFlow {
    connect = mockConnect;
    logout = mockLogout;
    getMailboxLock = mockGetMailboxLock.mockResolvedValue({ release: mockRelease });
    fetch = mockFetch;
    fetchOne = mockFetchOne;
    search = mockSearch;
    mailbox = { exists: 5 };
  }
  return { ImapFlow: MockImapFlow };
});

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
  },
}));

vi.mock("mailparser", () => ({
  simpleParser: vi.fn(),
}));

import { simpleParser } from "mailparser";
import { createMailTools } from "../mail-tools.js";

const config: YandexPluginConfig = {
  login: "user@yandex.ru",
  mail_app_password: "mail-secret",
};

function findTool(name: string) {
  const tools = createMailTools(config);
  return tools.find((t) => t.name === name)!;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("yad_mail_list", () => {
  it("connects, fetches messages, and disconnects", async () => {
    // mockFetch returns an async iterable
    const messages = [
      {
        seq: 4,
        uid: 104,
        envelope: {
          subject: "Hello",
          from: [{ name: "Alice", address: "alice@example.com" }],
          date: new Date("2026-04-01T10:00:00Z"),
        },
        flags: new Set(["\\Seen"]),
      },
      {
        seq: 5,
        uid: 105,
        envelope: {
          subject: "World",
          from: [{ name: "", address: "bob@example.com" }],
          date: new Date("2026-04-02T10:00:00Z"),
        },
        flags: new Set([]),
      },
    ];
    mockFetch.mockReturnValue(
      (async function* () {
        for (const m of messages) yield m;
      })(),
    );

    const tool = findTool("yad_mail_list");
    const result = await tool.execute("id", { folder: "INBOX", limit: 20 });
    const data = JSON.parse(result.content[0].text);

    expect(mockConnect).toHaveBeenCalledOnce();
    expect(mockLogout).toHaveBeenCalledOnce();
    expect(mockRelease).toHaveBeenCalledOnce();

    expect(data.total).toBe(5);
    expect(data.messages).toHaveLength(2);
    // Most recent first (reversed)
    expect(data.messages[0].subject).toBe("World");
    expect(data.messages[1].subject).toBe("Hello");
  });
});

describe("yad_mail_read", () => {
  it("fetches and parses a specific message", async () => {
    mockFetchOne.mockResolvedValue({
      source: Buffer.from("raw email content"),
    });
    vi.mocked(simpleParser).mockResolvedValue({
      subject: "Test subject",
      from: { text: "sender@example.com" },
      to: { text: "user@yandex.ru" },
      cc: undefined,
      date: new Date("2026-04-01T10:00:00Z"),
      text: "Hello!",
      html: false,
      attachments: [],
    } as ReturnType<typeof simpleParser> extends Promise<infer T> ? T : never);

    const tool = findTool("yad_mail_read");
    const result = await tool.execute("id", { uid: 105 });
    const data = JSON.parse(result.content[0].text);

    expect(data.subject).toBe("Test subject");
    expect(data.from).toBe("sender@example.com");
    expect(data.text).toBe("Hello!");
  });

  it("throws when message not found", async () => {
    mockFetchOne.mockResolvedValue({ source: null });

    const tool = findTool("yad_mail_read");
    await expect(tool.execute("id", { uid: 999 })).rejects.toThrow("Message UID 999 not found");
  });
});

describe("yad_mail_send", () => {
  it("sends email via SMTP", async () => {
    mockSendMail.mockResolvedValue({ messageId: "<test-id@yandex.ru>" });

    const tool = findTool("yad_mail_send");
    const result = await tool.execute("id", {
      to: "recipient@example.com",
      subject: "Test",
      text: "Hello!",
    });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "user@yandex.ru",
        to: "recipient@example.com",
        subject: "Test",
        text: "Hello!",
      }),
    );
    expect(result.content[0].text).toContain("<test-id@yandex.ru>");
  });
});

describe("yad_mail_search", () => {
  it("searches and returns matching messages", async () => {
    mockSearch.mockResolvedValue([101, 103, 105]);
    mockFetch.mockReturnValue(
      (async function* () {
        yield {
          uid: 101,
          envelope: {
            subject: "Match 1",
            from: [{ name: "Alice", address: "alice@test.com" }],
            date: new Date("2026-04-01"),
          },
          flags: new Set([]),
        };
        yield {
          uid: 103,
          envelope: {
            subject: "Match 2",
            from: [{ name: "Bob", address: "bob@test.com" }],
            date: new Date("2026-04-02"),
          },
          flags: new Set(["\\Seen"]),
        };
        yield {
          uid: 105,
          envelope: {
            subject: "Match 3",
            from: [{ name: "Carol", address: "carol@test.com" }],
            date: new Date("2026-04-03"),
          },
          flags: new Set([]),
        };
      })(),
    );

    const tool = findTool("yad_mail_search");
    const result = await tool.execute("id", { from: "alice@test.com" });
    const data = JSON.parse(result.content[0].text);

    expect(data.totalMatches).toBe(3);
    expect(data.messages).toHaveLength(3);
  });

  it("returns empty when no matches", async () => {
    mockSearch.mockResolvedValue([]);
    mockFetch.mockReturnValue((async function* () {})());

    const tool = findTool("yad_mail_search");
    const result = await tool.execute("id", { subject: "nonexistent" });
    const data = JSON.parse(result.content[0].text);

    expect(data.totalMatches).toBe(0);
    expect(data.messages).toHaveLength(0);
  });
});
