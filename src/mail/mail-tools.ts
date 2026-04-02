import { Type } from "@sinclair/typebox";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import type { YandexPluginConfig } from "../common/types.js";
import { jsonResult, requirePassword, resolveLogin, textResult } from "../common/types.js";

function createImapClient(config: YandexPluginConfig): ImapFlow {
  return new ImapFlow({
    host: "imap.yandex.ru",
    port: 993,
    secure: true,
    auth: {
      user: resolveLogin(config.login),
      pass: requirePassword(config, "mail"),
    },
    logger: false,
  });
}

function createSmtpTransport(config: YandexPluginConfig) {
  return nodemailer.createTransport({
    host: "smtp.yandex.ru",
    port: 465,
    secure: true,
    auth: {
      user: resolveLogin(config.login),
      pass: requirePassword(config, "mail"),
    },
  });
}

export function createMailTools(config: YandexPluginConfig) {
  return [
    {
      name: "yad_mail_list",
      description:
        "List email messages in a Yandex.Mail folder. " +
        "Returns subject, from, date, and flags for each message.",
      parameters: Type.Object(
        {
          folder: Type.Optional(
            Type.String({ description: 'Mailbox folder, default "INBOX"', default: "INBOX" }),
          ),
          limit: Type.Optional(
            Type.Integer({
              description: "Max messages to return (most recent first)",
              default: 20,
              minimum: 1,
              maximum: 100,
            }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { folder?: string; limit?: number }) {
        const client = createImapClient(config);
        try {
          await client.connect();
          const lock = await client.getMailboxLock(params.folder || "INBOX");
          try {
            const mailbox = client.mailbox;
            const total =
              mailbox && typeof mailbox === "object" && "exists" in mailbox ? mailbox.exists : 0;

            if (total === 0) {
              return jsonResult({
                folder: params.folder || "INBOX",
                total: 0,
                showing: 0,
                messages: [],
              });
            }

            const limit = params.limit || 20;
            const from = Math.max(1, total - limit + 1);
            const messages: Array<Record<string, unknown>> = [];

            for await (const msg of client.fetch(`${from}:*`, {
              envelope: true,
              flags: true,
            })) {
              messages.push({
                seq: msg.seq,
                uid: msg.uid,
                subject: msg.envelope?.subject || "(no subject)",
                from: msg.envelope?.from?.map((a) => `${a.name || ""} <${a.address}>`).join(", "),
                date: msg.envelope?.date?.toISOString(),
                flags: [...(msg.flags || [])],
              });
            }

            messages.reverse();
            return jsonResult({
              folder: params.folder || "INBOX",
              total,
              showing: messages.length,
              messages,
            });
          } finally {
            lock.release();
          }
        } finally {
          await client.logout();
        }
      },
    },
    {
      name: "yad_mail_read",
      description:
        "Read a specific email message by sequence number or UID. " +
        "Returns the full message with headers and text/HTML body.",
      parameters: Type.Object(
        {
          uid: Type.Integer({ description: "Message UID" }),
          folder: Type.Optional(
            Type.String({ description: 'Mailbox folder, default "INBOX"', default: "INBOX" }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { uid: number; folder?: string }) {
        const client = createImapClient(config);
        try {
          await client.connect();
          const lock = await client.getMailboxLock(params.folder || "INBOX");
          try {
            const message = await client.fetchOne(String(params.uid), {
              source: true,
              uid: true,
            });
            if (!message || !("source" in message) || !message.source) {
              throw new Error(`Message UID ${params.uid} not found`);
            }
            const parsed = await simpleParser(message.source as Buffer);
            return jsonResult({
              uid: params.uid,
              subject: parsed.subject,
              from: parsed.from?.text,
              to: Array.isArray(parsed.to)
                ? parsed.to.map((a) => a.text).join(", ")
                : parsed.to?.text,
              cc: Array.isArray(parsed.cc)
                ? parsed.cc.map((a) => a.text).join(", ")
                : parsed.cc?.text,
              date: parsed.date?.toISOString(),
              text: parsed.text || undefined,
              html: parsed.html || undefined,
              attachments: parsed.attachments?.map((a) => ({
                filename: a.filename,
                contentType: a.contentType,
                size: a.size,
              })),
            });
          } finally {
            lock.release();
          }
        } finally {
          await client.logout();
        }
      },
    },
    {
      name: "yad_mail_send",
      description: "Send an email via Yandex.Mail SMTP.",
      parameters: Type.Object(
        {
          to: Type.String({ description: "Recipient email address(es), comma-separated" }),
          subject: Type.String({ description: "Email subject" }),
          text: Type.Optional(Type.String({ description: "Plain text body" })),
          html: Type.Optional(Type.String({ description: "HTML body" })),
          cc: Type.Optional(Type.String({ description: "CC recipients" })),
          bcc: Type.Optional(Type.String({ description: "BCC recipients" })),
        },
        { additionalProperties: false },
      ),
      async execute(
        _id: string,
        params: {
          to: string;
          subject: string;
          text?: string;
          html?: string;
          cc?: string;
          bcc?: string;
        },
      ) {
        const transport = createSmtpTransport(config);
        const info = await transport.sendMail({
          from: resolveLogin(config.login),
          to: params.to,
          subject: params.subject,
          text: params.text,
          html: params.html,
          cc: params.cc,
          bcc: params.bcc,
        });
        return textResult(`Email sent. Message ID: ${info.messageId}`);
      },
    },
    {
      name: "yad_mail_search",
      description:
        "Search for emails in Yandex.Mail using IMAP search criteria. " +
        "Supports searching by subject, from, since date, etc.",
      parameters: Type.Object(
        {
          folder: Type.Optional(
            Type.String({ description: 'Mailbox folder, default "INBOX"', default: "INBOX" }),
          ),
          from: Type.Optional(Type.String({ description: "Filter by sender address" })),
          subject: Type.Optional(Type.String({ description: "Filter by subject" })),
          since: Type.Optional(Type.String({ description: "Messages since date (YYYY-MM-DD)" })),
          unseen: Type.Optional(Type.Boolean({ description: "Only unread messages" })),
          limit: Type.Optional(
            Type.Integer({ description: "Max results", default: 20, minimum: 1, maximum: 100 }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(
        _id: string,
        params: {
          folder?: string;
          from?: string;
          subject?: string;
          since?: string;
          unseen?: boolean;
          limit?: number;
        },
      ) {
        const client = createImapClient(config);
        try {
          await client.connect();
          const lock = await client.getMailboxLock(params.folder || "INBOX");
          try {
            const query: Record<string, unknown> = {};
            if (params.from) query.from = params.from;
            if (params.subject) query.subject = params.subject;
            if (params.since) query.since = params.since;
            if (params.unseen) query.seen = false;

            const searchResult = await client.search(query, { uid: true });
            const uids = Array.isArray(searchResult) ? searchResult : [];
            const limited = uids.slice(-1 * (params.limit || 20));
            const messages: Array<Record<string, unknown>> = [];

            if (limited.length > 0) {
              const uidRange = limited.join(",");
              for await (const msg of client.fetch(uidRange, {
                envelope: true,
                flags: true,
                uid: true,
              })) {
                messages.push({
                  uid: msg.uid,
                  subject: msg.envelope?.subject || "(no subject)",
                  from: msg.envelope?.from?.map((a) => `${a.name || ""} <${a.address}>`).join(", "),
                  date: msg.envelope?.date?.toISOString(),
                  flags: [...(msg.flags || [])],
                });
              }
            }

            messages.reverse();
            return jsonResult({
              folder: params.folder || "INBOX",
              totalMatches: uids.length,
              showing: messages.length,
              messages,
            });
          } finally {
            lock.release();
          }
        } finally {
          await client.logout();
        }
      },
    },
  ];
}
