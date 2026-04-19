import { readFileSync } from "node:fs";
import { createCalendarTools } from "./src/calendar/calendar-tools.js";
import { createMetaTools } from "./src/common/meta-tools.js";
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
  disk_oauth_token: process.env.YANDEX_DISK_OAUTH_TOKEN,
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

tools.push(...(createMetaTools({ version: pkg.version, enabledServices: enabled }) as ToolDef[]));

const toolMap = new Map(tools.map((t) => [t.name, t]));

// ---------------------------------------------------------------------------
// MCP protocol over stdio — hand-rolled JSON-RPC 2.0.
// ---------------------------------------------------------------------------
// We implement the subset of MCP we actually need (initialize, ping,
// tools/list, tools/call, notifications/message) directly instead of pulling
// @modelcontextprotocol/sdk with its transitive tree. Spec reference:
// https://modelcontextprotocol.io/specification
// ---------------------------------------------------------------------------

const LATEST_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

// JSON-RPC 2.0 standard error codes
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;
// MCP reserves -32002 for "server not initialized" (matches the reference SDK).
const SERVER_NOT_INITIALIZED = -32002;

let initialized = false;

type JsonRpcId = string | number | null;

interface JsonRpcMessage {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

let closed = false;

function writeMessage(msg: Record<string, unknown>): void {
  if (closed) return;
  try {
    process.stdout.write(`${JSON.stringify(msg)}\n`);
  } catch {
    closed = true;
  }
}

function sendResult(id: JsonRpcId, result: unknown): void {
  writeMessage({ jsonrpc: "2.0", id, result });
}

function sendError(id: JsonRpcId, code: number, message: string): void {
  writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
}

function sendNotification(method: string, params: Record<string, unknown>): void {
  writeMessage({ jsonrpc: "2.0", method, params });
}

// ---------------------------------------------------------------------------
// Request handlers
// ---------------------------------------------------------------------------
function handleInitialize(params: unknown): Record<string, unknown> {
  const requested = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
  const protocolVersion =
    typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
      ? requested
      : LATEST_PROTOCOL_VERSION;
  return {
    protocolVersion,
    capabilities: {
      tools: {},
      logging: {},
    },
    serverInfo: {
      name: "yad",
      version: pkg.version,
    },
  };
}

function handleToolsList(): Record<string, unknown> {
  return {
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.parameters,
    })),
  };
}

async function handleToolsCall(params: unknown): Promise<Record<string, unknown>> {
  const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
  const name = typeof p.name === "string" ? p.name : undefined;
  if (!name) {
    return {
      content: [{ type: "text", text: "Missing tool name" }],
      isError: true,
    };
  }
  const tool = toolMap.get(name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }
  try {
    const args = (p.arguments ?? {}) as Record<string, unknown>;
    return await tool.execute("mcp", args);
  } catch (err) {
    return {
      content: [
        { type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` },
      ],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Message dispatch
// ---------------------------------------------------------------------------
async function handleMessage(line: string): Promise<void> {
  let msg: JsonRpcMessage;
  try {
    msg = JSON.parse(line);
  } catch {
    sendError(null, PARSE_ERROR, "Parse error");
    return;
  }

  if (!msg || typeof msg !== "object") {
    sendError(null, INVALID_REQUEST, "Invalid request");
    return;
  }

  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    const id = isValidId(msg.id) ? (msg.id as JsonRpcId) : null;
    sendError(id, INVALID_REQUEST, "Invalid request");
    return;
  }

  const isNotification = msg.id === undefined;
  const id: JsonRpcId = isValidId(msg.id) ? (msg.id as JsonRpcId) : null;
  const method = msg.method;

  // Lifecycle guard: per MCP spec, only `initialize`, `ping`, and
  // notifications may be processed before the handshake completes.
  // Matches the behavior of the reference MCP SDK we replaced.
  if (!initialized && !isNotification && method !== "initialize" && method !== "ping") {
    sendError(id, SERVER_NOT_INITIALIZED, "Server not initialized");
    return;
  }

  try {
    switch (method) {
      case "initialize":
        if (isNotification) return;
        sendResult(id, handleInitialize(msg.params));
        initialized = true;
        return;
      case "notifications/initialized":
      case "notifications/cancelled":
        // No response for notifications
        return;
      case "ping":
        if (isNotification) return;
        sendResult(id, {});
        return;
      case "tools/list":
        if (isNotification) return;
        sendResult(id, handleToolsList());
        return;
      case "tools/call":
        if (isNotification) return;
        sendResult(id, await handleToolsCall(msg.params));
        return;
      default:
        // Unknown notifications are silently ignored per JSON-RPC 2.0.
        if (isNotification) return;
        sendError(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
        return;
    }
  } catch (err) {
    if (isNotification) return;
    sendError(id, INTERNAL_ERROR, err instanceof Error ? err.message : String(err));
  }
}

function isValidId(id: unknown): boolean {
  return typeof id === "string" || typeof id === "number" || id === null;
}

// ---------------------------------------------------------------------------
// stdin reader — newline-delimited JSON
// ---------------------------------------------------------------------------
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let newlineIndex = buffer.indexOf("\n");
  while (newlineIndex !== -1) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (line.length > 0) {
      void handleMessage(line).catch((err) => {
        console.error("yad-mcp: unhandled error:", err);
      });
    }
    newlineIndex = buffer.indexOf("\n");
  }
});
process.stdin.on("end", () => {
  void shutdown();
});

// ---------------------------------------------------------------------------
// IDLE watcher (opt-in via YANDEX_MAIL_IDLE_ENABLED=true)
// ---------------------------------------------------------------------------
// NOTE: In MCP mode, IDLE watcher sends logging notifications on new email.
// Unlike OpenClaw (which actively runs a subagent), MCP clients decide whether
// and how to act on these notifications. This is an inherent MCP limitation.
let idleWatcher: { stop: () => Promise<void> } | null = null;

function sendLog(level: "info" | "warning" | "error", data: unknown): void {
  sendNotification("notifications/message", { level, logger: "yad-idle", data });
}

if (config.mail_app_password && process.env.YANDEX_MAIL_IDLE_ENABLED === "true") {
  const folder = process.env.YANDEX_MAIL_IDLE_FOLDER || "INBOX";

  const logger: Logger = {
    info: (msg) => sendLog("info", msg),
    warn: (msg) => sendLog("warning", msg),
    error: (msg) => sendLog("error", msg),
  };

  idleWatcher = startIdleWatcher({
    config,
    logger,
    folder,
    notifyAgent: async (envelope) => {
      sendLog("info", JSON.stringify({ event: "new_email", ...envelope }));
    },
  });

  console.error(`yad-mcp: IDLE watcher enabled for "${folder}"`);
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown(): Promise<void> {
  if (closed) return;
  closed = true;
  try {
    await idleWatcher?.stop();
  } catch {
    // Best-effort: we're shutting down anyway.
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

console.error(`yad-mcp: running v${pkg.version}, services: ${enabled.join(", ")}`);
