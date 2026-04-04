import { ImapFlow } from "imapflow";
import type { PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import type { YandexPluginConfig } from "../common/types.js";
import { requirePassword, resolveLogin } from "../common/types.js";

export interface MailEnvelope {
  uid: number;
  from: string;
  subject: string;
  date: string;
  folder: string;
}

export interface IdleWatcherOptions {
  config: YandexPluginConfig;
  logger: PluginLogger;
  notifyAgent: (envelope: MailEnvelope) => Promise<void>;
  folder: string;
}

const MAX_BACKOFF_MS = 30_000;

export function startIdleWatcher(opts: IdleWatcherOptions): { stop: () => Promise<void> } {
  const { config, logger, notifyAgent, folder } = opts;

  let client: ImapFlow | null = null;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = 1000;

  function createClient(): ImapFlow {
    return new ImapFlow({
      host: "imap.yandex.ru",
      port: 993,
      secure: true,
      auth: {
        user: resolveLogin(config.login),
        pass: requirePassword(config, "mail"),
      },
      maxIdleTime: 5 * 60 * 1000,
      logger: false,
    });
  }

  async function connect() {
    if (stopped) return;

    client = createClient();

    client.on("exists", async (data: { path: string; count: number; prevCount: number }) => {
      if (data.count <= data.prevCount) return;

      try {
        const lock = await client!.getMailboxLock(data.path);
        try {
          const msg = await client!.fetchOne("*", { envelope: true, uid: true });
          if (msg && msg.envelope) {
            const envelope: MailEnvelope = {
              uid: msg.uid,
              from:
                msg.envelope.from
                  ?.map(
                    (a: { name?: string; address?: string }) => `${a.name || ""} <${a.address}>`,
                  )
                  .join(", ") || "",
              subject: msg.envelope.subject || "(no subject)",
              date: msg.envelope.date?.toISOString() || new Date().toISOString(),
              folder: data.path,
            };
            await notifyAgent(envelope);
          }
        } finally {
          lock.release();
        }
      } catch (err) {
        logger.error(`IDLE watcher: failed to process new message: ${err}`);
      }
    });

    client.on("close", () => {
      if (stopped) return;
      logger.warn(`IDLE watcher: connection closed, reconnecting in ${backoffMs}ms`);
      scheduleReconnect();
    });

    client.on("error", (err: Error) => {
      logger.error(`IDLE watcher: ${err.message}`);
    });

    try {
      await client.connect();
      await client.mailboxOpen(folder);
      await client.idle();
      backoffMs = 1000;
      logger.info(`IDLE watcher: monitoring "${folder}"`);
    } catch (err) {
      logger.error(`IDLE watcher: connection failed: ${err}`);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      await connect();
    }, backoffMs);
  }

  async function stop() {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (client) {
      try {
        await client.logout();
      } catch {
        // ignore logout errors during shutdown
      }
      client = null;
    }
  }

  connect();

  return { stop };
}
