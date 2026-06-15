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
import { ImapFlow, type ImapFlowOptions } from "imapflow";
import type Mail from "nodemailer/lib/mailer";
import type { YandexPluginConfig } from "../common/types.js";
/** Create an IMAP client, routing through the configured proxy when present. */
export declare function createImapClient(
  config: YandexPluginConfig,
  extra?: Partial<ImapFlowOptions>,
): ImapFlow;
/** Create an SMTP transport, routing through the configured proxy when present. */
export declare function createSmtpTransport(config: YandexPluginConfig): Mail;
