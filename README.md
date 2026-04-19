# Yad

Yandex services (Mail, Calendar, Disk, Contacts) for AI agents via **MCP protocol** and as an **OpenClaw plugin**.

All services use **app passwords** — no OAuth app required for basic use. Create passwords at [id.yandex.ru/security/app-passwords](https://id.yandex.ru/security/app-passwords).

Yandex.Disk additionally supports an **optional OAuth token** to handle files larger than ~10 MB, since Yandex's WebDAV gateway deliberately throttles and drops connections on large uploads.

## Services

| Service | Protocol | Credential | Tools |
|---------|----------|------------|:-----:|
| Yandex.Disk | WebDAV (≤10 MB) + REST API (>10 MB) | App password + optional OAuth token | 9 |
| Yandex.Mail | IMAP / SMTP | App password | 7 |
| Yandex.Calendar | CalDAV | App password | 5 |
| Yandex.Contacts | CardDAV | App password | 5 |

## MCP Server (Claude Desktop, Claude Code, Cursor, etc.)

### Quick start

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "yandex": {
      "command": "npx",
      "args": ["tsx", "/path/to/yad/mcp-server.ts"],
      "env": {
        "YANDEX_LOGIN": "user@yandex.ru",
        "YANDEX_DISK_APP_PASSWORD": "xxxx-xxxx-xxxx-xxxx",
        "YANDEX_DISK_OAUTH_TOKEN": "y0_...",
        "YANDEX_MAIL_APP_PASSWORD": "xxxx-xxxx-xxxx-xxxx",
        "YANDEX_CALENDAR_APP_PASSWORD": "xxxx-xxxx-xxxx-xxxx",
        "YANDEX_CONTACTS_APP_PASSWORD": "xxxx-xxxx-xxxx-xxxx"
      }
    }
  }
}
```

Only `YANDEX_LOGIN` is required. Include passwords only for the services you need — the rest will be skipped.

### IMAP IDLE (real-time mail monitoring)

Set `YANDEX_MAIL_IDLE_ENABLED=true` to enable background monitoring of incoming emails. New mail triggers an MCP logging notification to the client.

```json
{
  "env": {
    "YANDEX_MAIL_IDLE_ENABLED": "true",
    "YANDEX_MAIL_IDLE_FOLDER": "INBOX"
  }
}
```

### Environment variables

| Variable | Required | Description |
|----------|:--------:|-------------|
| `YANDEX_LOGIN` | yes | Yandex login or full email |
| `YANDEX_DISK_APP_PASSWORD` | | App password (type: Files) |
| `YANDEX_DISK_OAUTH_TOKEN` | | OAuth token for REST API — required for files > 10 MB. See [Large files (Disk OAuth)](#large-files-disk-oauth) |
| `YANDEX_MAIL_APP_PASSWORD` | | App password (type: Mail) |
| `YANDEX_CALENDAR_APP_PASSWORD` | | App password (type: Calendars) |
| `YANDEX_CONTACTS_APP_PASSWORD` | | App password (type: Contacts) |
| `YANDEX_MAIL_IDLE_ENABLED` | | Set to `true` to enable IDLE watcher |
| `YANDEX_MAIL_IDLE_FOLDER` | | IMAP folder to monitor (default: `INBOX`) |
| `YAD_UPLOAD_PROGRESS` | | Path to a log file for per-second upload progress (opt-in diagnostic) |

## OpenClaw Plugin

### Installation

```bash
git clone https://github.com/colibri11/yad.git
cd yad
npm install
openclaw plugins install -l .
```

### Configuration

In OpenClaw plugin config:

```json
{
  "login": "user@yandex.ru",
  "disk_app_password": "xxxx-xxxx-xxxx-xxxx",
  "disk_oauth_token": "y0_...",
  "mail_app_password": "xxxx-xxxx-xxxx-xxxx",
  "calendar_app_password": "xxxx-xxxx-xxxx-xxxx",
  "contacts_app_password": "xxxx-xxxx-xxxx-xxxx"
}
```

`disk_oauth_token` is optional — only needed if you want to upload/download files larger than 10 MB through Yandex.Disk. See [Large files (Disk OAuth)](#large-files-disk-oauth).

### IMAP IDLE (OpenClaw)

In OpenClaw, IDLE actively dispatches a subagent to process each incoming email:

```json
{
  "mail_idle_agent_id": "mail-processor",
  "mail_idle_folder": "INBOX"
}
```

## Tools

### Yandex.Disk (WebDAV + REST API)

| Tool | Description |
|------|-------------|
| `yad_disk_list` | List files and folders |
| `yad_disk_info` | Get file/folder properties |
| `yad_disk_download` | Download file — text/base64 in the response, or stream to a local path via `target_path` (recommended for binaries and large files to avoid bloating the agent context) |
| `yad_disk_upload` | Upload file via `content` (text/base64) or `source_path` (local file, streamed) |
| `yad_disk_mkdir` | Create folder (supports recursive) |
| `yad_disk_delete` | Delete file or folder |
| `yad_disk_move` | Move / rename |
| `yad_disk_copy` | Copy |
| `yad_disk_publish` | Publish / unpublish (get public link) |

Upload/download route automatically: files up to 10 MB go via WebDAV (app password); larger files require `disk_oauth_token` and use the REST API CDN. When OAuth is configured, downloads always use REST for speed.

### Yandex.Mail (IMAP/SMTP)

| Tool | Description |
|------|-------------|
| `yad_mail_list` | List messages in a folder |
| `yad_mail_read` | Read full message by UID |
| `yad_mail_send` | Send email with optional attachments |
| `yad_mail_get_attachment` | Download attachment from a message |
| `yad_mail_search` | Search by sender, subject, date |
| `yad_mail_delete` | Delete messages by UID (up to 100) |
| `yad_mail_mark` | Mark messages as read/unread |

### Yandex.Calendar (CalDAV)

| Tool | Description |
|------|-------------|
| `yad_calendar_list` | List calendars |
| `yad_calendar_events` | List events (with date range filter) |
| `yad_calendar_create_event` | Create event |
| `yad_calendar_update_event` | Update event |
| `yad_calendar_delete_event` | Delete event |

### Yandex.Contacts (CardDAV)

| Tool | Description |
|------|-------------|
| `yad_contacts_list` | List contacts |
| `yad_contacts_get` | Get contact |
| `yad_contacts_create` | Create contact |
| `yad_contacts_update` | Update contact |
| `yad_contacts_delete` | Delete contact |

## Creating app passwords

1. Go to [id.yandex.ru/security/app-passwords](https://id.yandex.ru/security/app-passwords)
2. Create a password for each service:
   - **Files** for Yandex.Disk
   - **Mail** for Yandex.Mail
   - **Calendars** for Yandex.Calendar
   - **Contacts** for Yandex.Contacts
3. Copy each password to your config

## Large files (Disk OAuth)

Yandex's WebDAV gateway throttles and drops connections on files larger than ~20–30 MB and becomes unreliably slow above ~10 MB (tens of minutes per file). To transfer larger files, `yad` can route through the Yandex.Disk REST API, which uses a CDN endpoint and doesn't suffer from the same limits. This path requires an **OAuth token** (app passwords don't work on the REST API).

Steps to get one:

1. Register an application at [oauth.yandex.ru/client/new](https://oauth.yandex.ru/client/new):
   - Platform: **Web service**
   - Redirect URL: `https://oauth.yandex.ru/verification_code`
   - Permissions (scopes): `cloud_api:disk.read` and `cloud_api:disk.write`
2. Copy the **Client ID** from the created application.
3. Open `https://oauth.yandex.ru/authorize?response_type=token&client_id=YOUR_CLIENT_ID` and approve access.
4. Copy the token (starts with `y0_`) from the redirect page.
5. Put it into `YANDEX_DISK_OAUTH_TOKEN` (MCP) or `disk_oauth_token` (OpenClaw config).

Without the token, uploads of files > 10 MB will fail with a clear error message pointing here; smaller files continue to work through WebDAV. Downloads always prefer REST when the token is available.

## Development

```bash
npm install                    # Install dependencies
npx tsc                        # Build to dist/
npx vitest run                 # Run tests
npx biome check .              # Lint + format
npx tsx scripts/smoke-test.ts  # E2E tests with real Yandex services
```

## License

[MIT](LICENSE)
