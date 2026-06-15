/**
 * Centralised factories for the Yandex.Mail IMAP client and SMTP transport.
 *
 * Every IMAP connection in the plugin (the per-tool clients in mail-tools.ts and
 * the long-lived IDLE watcher) and the SMTP transport are created here so that
 * proxy support — and any future shared option — is applied uniformly.
 *
 * Proxy handling:
 * - imapflow accepts a `proxy` URL and tunnels via HTTP CONNECT (http/https) or
 *   SOCKS (needs the `socks` module, which imapflow requires internally).
 * - nodemailer accepts a `proxy` URL too; HTTP CONNECT is built in, while SOCKS
 *   needs the `socks` module registered via `transporter.set('proxy_socks_module', socks)`.
 */
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import * as socks from "socks";
import { resolveProxy } from "../common/proxy.js";
import { requirePassword, resolveLogin } from "../common/types.js";
const IMAP_HOST = "imap.yandex.ru";
const IMAP_PORT = 993;
const SMTP_HOST = "smtp.yandex.ru";
const SMTP_PORT = 465;
/** Create an IMAP client, routing through the configured proxy when present. */
export function createImapClient(config, extra) {
    const proxy = resolveProxy(IMAP_HOST);
    return new ImapFlow({
        host: IMAP_HOST,
        port: IMAP_PORT,
        secure: true,
        auth: {
            user: resolveLogin(config.login),
            pass: requirePassword(config, "mail"),
        },
        logger: false,
        ...(proxy ? { proxy } : {}),
        ...extra,
    });
}
/** Create an SMTP transport, routing through the configured proxy when present. */
export function createSmtpTransport(config) {
    const proxy = resolveProxy(SMTP_HOST);
    const transport = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: true,
        auth: {
            user: resolveLogin(config.login),
            pass: requirePassword(config, "mail"),
        },
        // @types/nodemailer does not declare `proxy`, but nodemailer reads it at runtime.
        ...(proxy ? { proxy } : {}),
    });
    // nodemailer's built-in proxy support covers http(s) CONNECT; SOCKS needs the
    // socks module registered explicitly.
    if (proxy && /^socks/i.test(new URL(proxy).protocol)) {
        transport.set("proxy_socks_module", socks);
    }
    return transport;
}
//# sourceMappingURL=clients.js.map