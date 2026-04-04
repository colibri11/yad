import { beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import type { MailEnvelope } from "../idle-watcher.js";

const {
  mockConnect,
  mockLogout,
  mockMailboxOpen,
  mockIdle,
  mockGetMailboxLock,
  mockRelease,
  mockFetchOne,
  mockOn,
} = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockLogout: vi.fn(),
  mockMailboxOpen: vi.fn(),
  mockIdle: vi.fn(),
  mockGetMailboxLock: vi.fn(),
  mockRelease: vi.fn(),
  mockFetchOne: vi.fn(),
  mockOn: vi.fn(),
}));

vi.mock("imapflow", () => {
  class MockImapFlow {
    connect = mockConnect;
    logout = mockLogout;
    mailboxOpen = mockMailboxOpen;
    idle = mockIdle;
    getMailboxLock = mockGetMailboxLock.mockResolvedValue({ release: mockRelease });
    fetchOne = mockFetchOne;
    on = mockOn;
  }
  return { ImapFlow: MockImapFlow };
});

import { startIdleWatcher } from "../idle-watcher.js";

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const config = {
  login: "user@yandex.ru",
  mail_app_password: "test-pass",
};

function getHandler(event: string) {
  const call = (mockOn as MockInstance).mock.calls.find((c: unknown[]) => c[0] === event);
  return call?.[1] as (...args: unknown[]) => void;
}

describe("idle-watcher", () => {
  let notifyAgent: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockConnect.mockResolvedValue(undefined);
    mockMailboxOpen.mockResolvedValue(undefined);
    mockIdle.mockResolvedValue(true);
    notifyAgent = vi.fn().mockResolvedValue(undefined);
  });

  it("connects and opens mailbox on start", async () => {
    startIdleWatcher({
      config,
      logger: mockLogger,
      notifyAgent,
      folder: "INBOX",
    });

    // Let the connect() promise resolve
    await vi.runAllTimersAsync();

    expect(mockConnect).toHaveBeenCalled();
    expect(mockMailboxOpen).toHaveBeenCalledWith("INBOX");
  });

  it("notifies agent when new messages arrive (count > prevCount)", async () => {
    mockFetchOne.mockResolvedValue({
      uid: 42,
      envelope: {
        from: [{ name: "Sender", address: "sender@example.com" }],
        subject: "Test email",
        date: new Date("2026-04-04T10:00:00Z"),
      },
    });

    startIdleWatcher({
      config,
      logger: mockLogger,
      notifyAgent,
      folder: "INBOX",
    });

    await vi.runAllTimersAsync();

    const existsHandler = getHandler("exists");
    expect(existsHandler).toBeDefined();

    await existsHandler({ path: "INBOX", count: 6, prevCount: 5 });

    expect(mockGetMailboxLock).toHaveBeenCalledWith("INBOX");
    expect(mockFetchOne).toHaveBeenCalledWith("*", { envelope: true, uid: true });
    expect(notifyAgent).toHaveBeenCalledWith({
      uid: 42,
      from: "Sender <sender@example.com>",
      subject: "Test email",
      date: "2026-04-04T10:00:00.000Z",
      folder: "INBOX",
    } satisfies MailEnvelope);
    expect(mockRelease).toHaveBeenCalled();
  });

  it("does NOT notify when count <= prevCount", async () => {
    startIdleWatcher({
      config,
      logger: mockLogger,
      notifyAgent,
      folder: "INBOX",
    });

    await vi.runAllTimersAsync();

    const existsHandler = getHandler("exists");
    await existsHandler({ path: "INBOX", count: 5, prevCount: 5 });

    expect(notifyAgent).not.toHaveBeenCalled();
  });

  it("reconnects on connection close with backoff", async () => {
    startIdleWatcher({
      config,
      logger: mockLogger,
      notifyAgent,
      folder: "INBOX",
    });

    await vi.runAllTimersAsync();
    expect(mockConnect).toHaveBeenCalledTimes(1);

    // Simulate close
    const closeHandler = getHandler("close");
    closeHandler();

    // First reconnect after 1s (initial backoff)
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  it("stops cleanly and prevents reconnect", async () => {
    const watcher = startIdleWatcher({
      config,
      logger: mockLogger,
      notifyAgent,
      folder: "INBOX",
    });

    await vi.runAllTimersAsync();

    await watcher.stop();

    expect(mockLogout).toHaveBeenCalled();

    // Verify no reconnect after stop
    const closeHandler = getHandler("close");
    closeHandler();
    await vi.advanceTimersByTimeAsync(60_000);
    // connect should only have been called once (initial)
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("handles fetchOne returning false gracefully", async () => {
    mockFetchOne.mockResolvedValue(false);

    startIdleWatcher({
      config,
      logger: mockLogger,
      notifyAgent,
      folder: "INBOX",
    });

    await vi.runAllTimersAsync();

    const existsHandler = getHandler("exists");
    await existsHandler({ path: "INBOX", count: 6, prevCount: 5 });

    expect(notifyAgent).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalled();
  });

  it("uses custom folder from options", async () => {
    startIdleWatcher({
      config,
      logger: mockLogger,
      notifyAgent,
      folder: "Work",
    });

    await vi.runAllTimersAsync();
    expect(mockMailboxOpen).toHaveBeenCalledWith("Work");
  });
});
