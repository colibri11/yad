import { readFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createCalendarTools } from "./src/calendar/calendar-tools.js";
import type { Logger, YandexPluginConfig } from "./src/common/types.js";
import { createContactsTools } from "./src/contacts/contacts-tools.js";
import { createDiskTools } from "./src/disk/disk-tools.js";
import { startIdleWatcher } from "./src/mail/idle-watcher.js";
import { createMailTools } from "./src/mail/mail-tools.js";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

// ---------------------------------------------------------------------------
// Config from environment variables
// ---------------------------------------------------------------------------
const config: YandexPluginConfig = {
  login: process.env.YANDEX_LOGIN || "",
  disk_app_password: process.env.YANDEX_DISK_APP_PASSWORD,
  mail_app_password: process.env.YANDEX_MAIL_APP_PASSWORD,
  calendar_app_password: process.env.YANDEX_CALENDAR_APP_PASSWORD,
  contacts_app_password: process.env.YANDEX_CONTACTS_APP_PASSWORD,
};

if (!config.login) {
  console.error("yad-mcp: YANDEX_LOGIN environment variable is required");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Collect tools from enabled services
// ---------------------------------------------------------------------------
interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (...args: unknown[]) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

const tools: ToolDef[] = [];
const enabled: string[] = [];

if (config.disk_app_password) {
  tools.push(...(createDiskTools(config) as ToolDef[]));
  enabled.push("Disk");
}
if (config.mail_app_password) {
  tools.push(...(createMailTools(config) as ToolDef[]));
  enabled.push("Mail");
}
if (config.calendar_app_password) {
  tools.push(...(createCalendarTools(config) as ToolDef[]));
  enabled.push("Calendar");
}
if (config.contacts_app_password) {
  tools.push(...(createContactsTools(config) as ToolDef[]));
  enabled.push("Contacts");
}

if (tools.length === 0) {
  console.error(
    "yad-mcp: no app passwords configured. " +
      "Set YANDEX_DISK_APP_PASSWORD, YANDEX_MAIL_APP_PASSWORD, etc.",
  );
  process.exit(1);
}

const toolMap = new Map(tools.map((t) => [t.name, t]));

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------
const server = new Server(
  { name: "yad", version: pkg.version },
  {
    capabilities: {
      tools: {},
      logging: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.parameters,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = toolMap.get(name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    return await tool.execute("mcp", args ?? {});
  } catch (err) {
    return {
      content: [
        { type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` },
      ],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// IDLE watcher (opt-in via YANDEX_MAIL_IDLE_ENABLED=true)
// ---------------------------------------------------------------------------
// NOTE: In MCP mode, IDLE watcher sends logging notifications on new email.
// Unlike OpenClaw (which actively runs a subagent), MCP clients decide whether
// and how to act on these notifications. This is an inherent MCP limitation.
let idleWatcher: { stop: () => Promise<void> } | null = null;

if (config.mail_app_password && process.env.YANDEX_MAIL_IDLE_ENABLED === "true") {
  const folder = process.env.YANDEX_MAIL_IDLE_FOLDER || "INBOX";

  const noop = () => {};
  const logger: Logger = {
    info: (msg) =>
      void server.sendLoggingMessage({ level: "info", logger: "yad-idle", data: msg }).catch(noop),
    warn: (msg) =>
      void server
        .sendLoggingMessage({ level: "warning", logger: "yad-idle", data: msg })
        .catch(noop),
    error: (msg) =>
      void server.sendLoggingMessage({ level: "error", logger: "yad-idle", data: msg }).catch(noop),
  };

  idleWatcher = startIdleWatcher({
    config,
    logger,
    folder,
    notifyAgent: async (envelope) => {
      await server.sendLoggingMessage({
        level: "info",
        logger: "yad-idle",
        data: JSON.stringify({ event: "new_email", ...envelope }),
      });
    },
  });

  console.error(`yad-mcp: IDLE watcher enabled for "${folder}"`);
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown() {
  await idleWatcher?.stop();
  await server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
server.onclose = () => {
  idleWatcher?.stop();
};

// ---------------------------------------------------------------------------
// Start stdio transport
// ---------------------------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`yad-mcp: running v${pkg.version}, services: ${enabled.join(", ")}`);
