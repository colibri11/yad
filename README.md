# Yad

Yandex services (Mail, Calendar, Disk, Contacts) for AI agents via **MCP protocol** and as an **OpenClaw plugin**.

All services use **app passwords** — no OAuth app required. Create passwords at [id.yandex.ru/security/app-passwords](https://id.yandex.ru/security/app-passwords).

## Services

| Service | Protocol | App password type | Tools |
|---------|----------|-------------------|:-----:|
| Yandex.Disk | WebDAV | Files | 9 |
| Yandex.Mail | IMAP / SMTP | Mail | 7 |
| Yandex.Calendar | CalDAV | Calendars | 5 |
| Yandex.Contacts | CardDAV | Contacts | 5 |

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
| `YANDEX_MAIL_APP_PASSWORD` | | App password (type: Mail) |
| `YANDEX_CALENDAR_APP_PASSWORD` | | App password (type: Calendars) |
| `YANDEX_CONTACTS_APP_PASSWORD` | | App password (type: Contacts) |
| `YANDEX_MAIL_IDLE_ENABLED` | | Set to `true` to enable IDLE watcher |
| `YANDEX_MAIL_IDLE_FOLDER` | | IMAP folder to monitor (default: `INBOX`) |

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
  "mail_app_password": "xxxx-xxxx-xxxx-xxxx",
  "calendar_app_password": "xxxx-xxxx-xxxx-xxxx",
  "contacts_app_password": "xxxx-xxxx-xxxx-xxxx"
}
```

### IMAP IDLE (OpenClaw)

In OpenClaw, IDLE actively dispatches a subagent to process each incoming email:

```json
{
  "mail_idle_agent_id": "mail-processor",
  "mail_idle_folder": "INBOX"
}
```

## Tools

### Yandex.Disk (WebDAV)

| Tool | Description |
|------|-------------|
| `yad_disk_list` | List files and folders |
| `yad_disk_info` | Get file/folder properties |
| `yad_disk_download` | Download file (text or base64) |
| `yad_disk_upload` | Upload file (text, base64, or local file) |
| `yad_disk_mkdir` | Create folder (supports recursive) |
| `yad_disk_delete` | Delete file or folder |
| `yad_disk_move` | Move / rename |
| `yad_disk_copy` | Copy |
| `yad_disk_publish` | Publish / unpublish (get public link) |

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
