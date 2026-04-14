import { Type } from "@sinclair/typebox";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import type { YandexPluginConfig } from "../common/types.js";
import { jsonResult, requirePassword, resolveLogin, textResult } from "../common/types.js";

/**
 * Fetch a single message by UID with fallback to sequence-number-based fetch.
 * Yandex IMAP's UID FETCH is unreliable for recently-delivered or self-sent messages:
 * the server's search index sees the UID but UID FETCH returns nothing.
 * Sequence-number-based FETCH works reliably, so we fall back to it.
 */
async function fetchOneByUid(
  client: ImapFlow,
  uid: number,
  query: Record<string, unknown>,
): Promise<ReturnType<ImapFlow["fetchOne"]>> {
  // Try UID-based fetch first
  const result = await client.fetchOne(String(uid), { ...query, uid: true } as Parameters<
    ImapFlow["fetchOne"]
  >[1]);
  if (result) return result;

  // Fallback: find sequence number via SEARCH UID, then fetch by sequence number
  const seqs = await client.search({ uid: String(uid) });
  if (!seqs || !Array.isArray(seqs) || seqs.length === 0) return false;
  return client.fetchOne(String(seqs[0]), query as Parameters<ImapFlow["fetchOne"]>[1]);
}

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
        "Read a specific email message by UID. " +
        "Returns the full message with headers, text/HTML body, and attachment list. " +
        "Use UIDs from yad_mail_list or yad_mail_search results.",
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
            const message = await fetchOneByUid(client, params.uid, { source: true });
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
              attachments: parsed.attachments?.map((a, i) => ({
                index: i,
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
      description:
        "Send an email via Yandex.Mail SMTP. " +
        "Supports file attachments by path or inline content.",
      parameters: Type.Object(
        {
          to: Type.String({ description: "Recipient email address(es), comma-separated" }),
          subject: Type.String({ description: "Email subject" }),
          text: Type.Optional(Type.String({ description: "Plain text body" })),
          html: Type.Optional(Type.String({ description: "HTML body" })),
          cc: Type.Optional(Type.String({ description: "CC recipients" })),
          bcc: Type.Optional(Type.String({ description: "BCC recipients" })),
          attachments: Type.Optional(
            Type.Array(
              Type.Object(
                {
                  filename: Type.String({ description: "Attachment filename (e.g. report.pdf)" }),
                  path: Type.Optional(
                    Type.String({
                      description: "Absolute path to a local file to attach",
                    }),
                  ),
                  content: Type.Optional(
                    Type.String({
                      description: "Text content of the attachment (for .txt, .md, .csv, etc.)",
                    }),
                  ),
                },
                { additionalProperties: false },
              ),
              { description: "File attachments. Provide either path or content for each." },
            ),
          ),
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
          attachments?: Array<{ filename: string; path?: string; content?: string }>;
        },
      ) {
        const transport = createSmtpTransport(config);
        const mailAttachments = params.attachments?.map((a) => ({
          filename: a.filename,
          ...(a.path ? { path: a.path } : {}),
          ...(a.content ? { content: a.content } : {}),
        }));
        const info = await transport.sendMail({
          from: resolveLogin(config.login),
          to: params.to,
          subject: params.subject,
          text: params.text,
          html: params.html,
          cc: params.cc,
          bcc: params.bcc,
          attachments: mailAttachments,
        });
        return textResult(`Email sent. Message ID: ${info.messageId}`);
      },
    },
    {
      name: "yad_mail_get_attachment",
      description:
        "Download an email attachment by message UID and filename. " +
        "Use index to disambiguate when multiple attachments share the same filename. " +
        "Returns content as text for text-based types, or base64 for binary.\n\n" +
        "IMPORTANT — how to handle the result:\n" +
        "1. Treat contentType as advisory, not authoritative. Mail providers may label text files " +
        "(e.g. .md, .txt, .json) with generic MIME types such as application/octet-stream.\n" +
        "2. If encoding is base64, ALWAYS decode the payload before deciding whether the content is text or binary. " +
        "Never infer readability from visible fragments of base64.\n" +
        "3. After decoding, use filename extension and decoded content to determine the actual type: " +
        "if the bytes are valid UTF-8 text, treat as text (markdown, plain text, JSON, CSV, XML, source code, etc.).\n" +
        "4. Small text-like files may be read into context. " +
        "Large files, PDFs, images, audio, video, and archives should be summarized by metadata or routed to specialized tools.\n" +
        "5. Do not place large binary payloads into model context.",
      parameters: Type.Object(
        {
          uid: Type.Integer({ description: "Message UID" }),
          filename: Type.String({
            description: "Attachment filename (as returned by yad_mail_read)",
          }),
          index: Type.Optional(
            Type.Integer({
              description:
                "Attachment index (0-based, as returned by yad_mail_read). Use when multiple attachments have the same filename.",
            }),
          ),
          folder: Type.Optional(
            Type.String({ description: 'Mailbox folder, default "INBOX"', default: "INBOX" }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(
        _id: string,
        params: { uid: number; filename: string; index?: number; folder?: string },
      ) {
        const client = createImapClient(config);
        try {
          await client.connect();
          const lock = await client.getMailboxLock(params.folder || "INBOX");
          try {
            const message = await fetchOneByUid(client, params.uid, { source: true });
            if (!message || !("source" in message) || !message.source) {
              throw new Error(`Message UID ${params.uid} not found`);
            }
            const parsed = await simpleParser(message.source as Buffer);
            const attachment =
              params.index != null
                ? parsed.attachments?.[params.index]
                : parsed.attachments?.find((a) => a.filename === params.filename);
            if (!attachment) {
              const available = parsed.attachments?.map((a) => a.filename).join(", ") || "none";
              throw new Error(`Attachment "${params.filename}" not found. Available: ${available}`);
            }
            const isText = attachment.contentType.startsWith("text/");
            return jsonResult({
              filename: attachment.filename,
              contentType: attachment.contentType,
              size: attachment.size,
              encoding: isText ? "utf-8" : "base64",
              content: isText
                ? attachment.content.toString("utf-8")
                : attachment.content.toString("base64"),
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
      name: "yad_mail_delete",
      description:
        "Delete emails from a Yandex.Mail folder. DESTRUCTIVE — messages are permanently removed and cannot be recovered. " +
        "Accepts an array of UIDs to delete in a single call (up to 100). " +
        "Non-existent UIDs are silently ignored.",
      parameters: Type.Object(
        {
          folder: Type.Optional(
            Type.String({ description: 'Mailbox folder, default "INBOX"', default: "INBOX" }),
          ),
          uids: Type.Array(Type.Integer({ description: "Message UID" }), {
            description: "Message UIDs to delete (1–100)",
            minItems: 1,
            maxItems: 100,
          }),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { folder?: string; uids: number[] }) {
        const client = createImapClient(config);
        try {
          await client.connect();
          const lock = await client.getMailboxLock(params.folder || "INBOX");
          try {
            const uidRange = params.uids.join(",");
            const deleted = await client.messageDelete(uidRange, { uid: true });
            return jsonResult({
              folder: params.folder || "INBOX",
              deleted: deleted ? params.uids : [],
              failed: deleted ? [] : params.uids,
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
      name: "yad_mail_mark",
      description:
        "Change the read/unread status of emails in a Yandex.Mail folder. " +
        "Set seen=true to mark as read, seen=false to mark as unread. " +
        "Accepts an array of UIDs (up to 100). Non-existent UIDs are silently ignored.",
      parameters: Type.Object(
        {
          folder: Type.Optional(
            Type.String({ description: 'Mailbox folder, default "INBOX"', default: "INBOX" }),
          ),
          uids: Type.Array(Type.Integer({ description: "Message UID" }), {
            description: "Message UIDs to update (1–100)",
            minItems: 1,
            maxItems: 100,
          }),
          seen: Type.Boolean({ description: "true = mark as read, false = mark as unread" }),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { folder?: string; uids: number[]; seen: boolean }) {
        const client = createImapClient(config);
        try {
          await client.connect();
          const lock = await client.getMailboxLock(params.folder || "INBOX");
          try {
            const uidRange = params.uids.join(",");
            const result = params.seen
              ? await client.messageFlagsAdd(uidRange, ["\\Seen"], { uid: true })
              : await client.messageFlagsRemove(uidRange, ["\\Seen"], { uid: true });
            return jsonResult({
              folder: params.folder || "INBOX",
              updated: result ? params.uids : [],
              seen: params.seen,
              failed: result ? [] : params.uids,
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

            // Search returns sequence numbers (not UIDs) — sequence-based FETCH
            // is more reliable on Yandex IMAP than UID-based FETCH.
            const searchResult = await client.search(query);
            const seqs = Array.isArray(searchResult) ? searchResult : [];
            const limited = seqs.slice(-1 * (params.limit || 20));
            const messages: Array<Record<string, unknown>> = [];

            if (limited.length > 0) {
              const seqRange = limited.join(",");
              for await (const msg of client.fetch(seqRange, {
                envelope: true,
                flags: true,
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
              totalMatches: seqs.length,
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
