# Changelog

## v1.1.0

- **Drop `@modelcontextprotocol/sdk` runtime dependency.** `mcp-server.ts` now implements the MCP stdio protocol directly (JSON-RPC 2.0 over newline-delimited stdin/stdout). Supports `initialize`, `ping`, `tools/list`, `tools/call`, plus outbound `notifications/message` for IDLE watcher logging. Eliminates the SDK's large transitive dependency tree from plugin installs — yad's production `node_modules` now contains only Yandex-protocol libraries (`imapflow`, `tsdav`, `nodemailer`, `mailparser`, `@sinclair/typebox`). Fixes the upgrade friction hit when moving from v0.7.1 → v1.0.x, where plugin installs pulled MCP SDK + transitive deps that were never needed at plugin runtime. Includes a lifecycle guard rejecting non-`initialize`/non-`ping` requests before the handshake completes.

## v1.0.1

- **Fix: tools not available to agents in multi-agent mode.** The process-global idempotency guard introduced in v0.7.1 was too coarse: in multi-agent mode each agent receives its own `api` with its own tool registry, and the first call set a global flag that caused every subsequent agent's `register()` to short-circuit before registering any tools. Tools are now registered on every `register()` call. Only the IMAP IDLE watcher — the one resource that truly must be a process singleton — stays behind a `Symbol.for("yad.idleServiceRegistered")` guard.

## v0.7.1

- **Idempotency guard in `register()`** — the plugin now initializes exactly once per process. Repeated calls from the gateway plugin loader are detected via a process-global flag and short-circuited with an info log. Prevents duplicate tool registration, log noise, and unnecessary IMAP IDLE reconnects.

## v0.7.0

### New tools

- **yad_mail_delete** — delete emails by UID. Accepts an array of up to 100 UIDs per call. Marked as destructive in the tool description.
- **yad_mail_mark** — change read/unread status. `seen: true` marks as read, `seen: false` marks as unread. Bulk support (up to 100 UIDs).

### Fixes

- **IMAP UID FETCH reliability** — Yandex IMAP sometimes fails to return messages via `UID FETCH` (especially recently-delivered or self-sent emails), while sequence-number-based `FETCH` works correctly. Added `fetchOneByUid()` fallback: tries UID first, then resolves via `SEARCH UID` → sequence number. Affects `yad_mail_read`, `yad_mail_get_attachment`, and `yad_mail_search`.
- **yad_mail_search** — switched from UID-based to sequence-number-based fetch for result details, fixing cases where search found matches but returned empty results.
- **yad_mail_read** — fixed description: was incorrectly mentioning "sequence number or UID", now correctly states UID only.

## v0.6.2

- Plugin version visible to agents — description now includes the version number, read from `package.json` at load time.

## v0.6.1

- **yad_disk_mkdir**: `recursive=true` — creates all missing parent folders (like `mkdir -p`).
- Removed transfer timeouts on upload/download.

## v0.6.0

- **yad_disk_upload**: binary file support — three modes: text content, base64, and `source_path` for local files.
- No transfer timeouts on upload/download.
- Subagent guidance in upload/download descriptions.

## v0.5.1

- **yad_mail_get_attachment**: LLM-facing handling instructions in tool description.

## v0.5.0

- **IMAP IDLE watcher** — real-time mail monitoring via persistent IMAP connection (RFC 2177).
- SDK upgrade to `openclaw@2026.4.2`.
- Calendar DTSTART fixes, contacts name mapping fix.
