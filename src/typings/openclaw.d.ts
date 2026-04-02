declare module "openclaw/plugin-sdk/plugin-entry" {
  import type { TObject } from "@sinclair/typebox";

  interface PluginLogger {
    debug(msg: string): void;
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  }

  interface OpenClawPluginApi {
    id: string;
    config: Record<string, unknown>;
    pluginConfig: Record<string, unknown>;
    logger: PluginLogger;
    registerTool(tool: AnyAgentTool): void;
  }

  interface ToolResult {
    content: Array<{ type: "text"; text: string }>;
  }

  interface AnyAgentTool {
    name: string;
    description: string;
    parameters: TObject;
    execute(...args: unknown[]): Promise<ToolResult>;
  }

  interface OpenClawPluginDefinition {
    id: string;
    name: string;
    description: string;
    register(api: OpenClawPluginApi): void;
  }

  export function definePluginEntry(def: OpenClawPluginDefinition): OpenClawPluginDefinition;
  export type { AnyAgentTool, OpenClawPluginApi, OpenClawPluginDefinition, ToolResult };
}
