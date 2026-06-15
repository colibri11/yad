# Changelog

## v1.4.1

- **Fix: `yad_diagnose` reported a false green for IMAP behind a hostname-scoped proxy ACL.** The reachability probe sent `CONNECT <hostname>` for every transport, but `imapflow` (IMAP) pre-resolves the host and sends `CONNECT <IP>:993`. A proxy that authorises CONNECT by hostname/domain (e.g. squid `dstdomain .yandex.ru`) let the hostname-probe through while denying the real IP-based IMAP connection — so diagnostics showed IMAP `ok=true` while `yad_mail_*` failed with `EPROXY` / `Invalid response from proxy: 403`. The probe now replicates each client's actual CONNECT target (IMAP → DNS-resolved IP like imapflow; SMTP/WebDAV/CalDAV/CardDAV/Disk-REST → hostname), and each result includes a `connectVia` field (`ip`/`hostname`). The fail-closed docs and the `yad_diagnose` description now state that the proxy ACL must allow CONNECT to 993 by destination IP (not just by hostname). The v1.4.0 proxy transport itself was correct — this is a diagnostics-accuracy fix.

## v1.4.0

- **Proxy-aware transport for fail-closed networks.** All outbound connections — Mail (IMAP/SMTP), Disk (WebDAV + REST), Calendar (CalDAV), Contacts (CardDAV) — now route through an HTTP CONNECT or SOCKS proxy when one is configured via the standard `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` / `NO_PROXY` environment variables (plus an explicit `YAD_PROXY_URL` override). Required for containers with no direct internet egress. When no proxy env is set, behaviour is unchanged — direct connections, no regression. Node's global `fetch` (undici) ignores proxy env, and the native `node:https` streaming upload/download paths connect directly; both are now routed explicitly, and imapflow/nodemailer receive the proxy too. Supports `http`/`https`/`socks5` schemes; `NO_PROXY` is honoured per host. Mail requires the proxy to allow `CONNECT` on ports 993 (IMAP) and 465 (SMTP); Disk/Calendar/Contacts need only 443.
- **New tool: `yad_diagnose`.** Reports which proxy each transport resolves to (credentials masked) and runs a live reachability probe — tunnel setup plus a TLS handshake, no credentials sent — to every endpoint. Validates a deployment in a single call. The startup log also prints a one-line proxy summary.
- IMAP client creation is centralised into a single factory shared by the mail tools and the IDLE watcher, so proxy support and future shared options apply uniformly.
- New runtime dependencies: `undici`, `socks`.

## v1.3.1

- **Fix: `ENOENT: dist/package.json` on plugin load.** v1.3.0 ships the compiled entry from `dist/index.js`, but `index.ts` and `mcp-server.ts` resolved `package.json` relative to `import.meta.url` (`./package.json`) — which after compilation points at the non-existent `dist/package.json` instead of the repo root. OpenClaw 2026.5.18 gateway aborted the load with ENOENT, no `yad_*` tools registered (the `openclaw plugins list` manifest view masked it). Path corrected to `../package.json` so the compiled entry resolves the root `package.json`. Source no longer runs through `tsx`/`ts-node` directly — `dist/` is the contractual entry point since OpenClaw 5.18.

## v1.3.0

- **Ship compiled `dist/` directly in the repo.** Required by OpenClaw 2026.5.18+ which removed the source-only TS runtime fallback — installs of plugins with a TypeScript entry now hard-fail unless `dist/index.js` is present in the package. Earlier hosts loaded `index.ts` via a jiti shim that the gateway no longer supports.
- `package.json`: add `main` (`dist/index.js`), `types` (`dist/index.d.ts`), `scripts.build` (`tsc`).
- `.gitattributes`: mark `dist/**` as `linguist-generated -diff` to keep PR diffs readable.
- `.gitignore`: drop `dist/` (now tracked).

## v1.2.1

- **Fix: `disk_oauth_token` rejected by config validation.** v1.2.0 shipped the OAuth REST API path but forgot to declare `disk_oauth_token` in `openclaw.plugin.json`. With `additionalProperties: false` on `configSchema`, OpenClaw rejected configs that included the token — the very configs the new code needs to function. Adds the property to `configSchema.properties` (matching the app-password shape) with a sensitive `uiHint` linking to the OAuth setup page. MCP-server deployments were unaffected — they read env vars directly.

## v1.2.0

- **New transport: Yandex.Disk REST API for large files.** Yandex's WebDAV gateway throttles uploads and silently drops connections above ~20–30 MB, and delays the 201 response ~60s per MB during post-upload hash + antivirus scanning, making medium files (5–10 MB) effectively unusable. Files > 10 MB now route through the REST API CDN using an OAuth token (`disk_oauth_token` / `YANDEX_DISK_OAUTH_TOKEN`); app passwords continue to work for everything else.
- **`yad_disk_download` gained `target_path`** — stream the file to a local path and return only metadata, avoiding base64 bloat in the agent context. Partial downloads are cleaned up on error.
- **`yad_disk_upload` streams from `source_path`** via `node:https` with proper `Expect: 100-continue` handling (undici-fetch buffers bodies and breaks Yandex's handshake).
- Adaptive WebDAV upload timeout: 60s base + 60s/MB × 2 margin, matching Yandex's documented server-side throttle.
- Optional `YAD_UPLOAD_PROGRESS` diagnostic log for slow uploads.
- Smoke-test adds a 12 MB REST round-trip with sha256 verification.

## v1.1.0

- **Drop `@modelcontextprotocol/sdk` runtime dependency.** `mcp-server.ts` now implements the MCP stdio protocol directly (JSON-RPC 2.0 over newline-delimited stdin/stdout). Supports `initialize`, `ping`, `tools/list`, `tools/call`, plus outbound `notifications/message` for IDLE watcher logging. Eliminates the SDK's large transitive dependency tree from plugin installs — yad's production `node_modules` now contains only Yandex-protocol libraries (`imapflow`, `tsdav`, `nodemailer`, `mailparser`, `@sinclair/typebox`). Fixes the upgrade friction hit when moving from v0.7.1 → v1.0.x, where plugin installs pulled MCP SDK + transitive deps that were never needed at plugin runtime. Includes a lifecycle guard rejecting non-`initialize`/non-`ping` requests before the handshake completes.
- **New tool: `yad_version`.** Returns runtime info about the running yad instance — plugin version, enabled services, process start time, uptime, pid. Lets an agent verify at any time which build it is actually talking to, rather than relying on the `serverInfo` version from the MCP `initialize` handshake (which isn't surfaced to agents). Especially useful during iterative plugin development and after upgrades, when stale cached binaries would otherwise be indistinguishable from a fresh install.

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
