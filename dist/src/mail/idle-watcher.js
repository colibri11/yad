import { ImapFlow } from "imapflow";
import { requirePassword, resolveLogin } from "../common/types.js";
const MAX_BACKOFF_MS = 30_000;
export function startIdleWatcher(opts) {
    const { config, logger, notifyAgent, folder } = opts;
    let client = null;
    let stopped = false;
    let reconnectTimer = null;
    let backoffMs = 1000;
    function createClient() {
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
        if (stopped)
            return;
        client = createClient();
        client.on("exists", async (data) => {
            if (data.count <= data.prevCount)
                return;
            try {
                const lock = await client.getMailboxLock(data.path);
                try {
                    const msg = await client.fetchOne("*", { envelope: true, uid: true });
                    if (msg && msg.envelope) {
                        const envelope = {
                            uid: msg.uid,
                            from: msg.envelope.from
                                ?.map((a) => `${a.name || ""} <${a.address}>`)
                                .join(", ") || "",
                            subject: msg.envelope.subject || "(no subject)",
                            date: msg.envelope.date?.toISOString() || new Date().toISOString(),
                            folder: data.path,
                        };
                        await notifyAgent(envelope);
                    }
                }
                finally {
                    lock.release();
                }
            }
            catch (err) {
                logger.error(`IDLE watcher: failed to process new message: ${err}`);
            }
        });
        client.on("close", () => {
            if (stopped)
                return;
            logger.warn(`IDLE watcher: connection closed, reconnecting in ${backoffMs}ms`);
            scheduleReconnect();
        });
        client.on("error", (err) => {
            logger.error(`IDLE watcher: ${err.message}`);
        });
        try {
            await client.connect();
            await client.mailboxOpen(folder);
            await client.idle();
            backoffMs = 1000;
            logger.info(`IDLE watcher: monitoring "${folder}"`);
        }
        catch (err) {
            logger.error(`IDLE watcher: connection failed: ${err}`);
            scheduleReconnect();
        }
    }
    function scheduleReconnect() {
        if (stopped || reconnectTimer)
            return;
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
            }
            catch {
                // ignore logout errors during shutdown
            }
            client = null;
        }
    }
    connect();
    return { stop };
}
//# sourceMappingURL=idle-watcher.js.map