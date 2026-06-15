import type { OpenClawPluginDefinition } from "openclaw/plugin-sdk/plugin-entry";
declare const _default: {
  id: string;
  name: string;
  description: string;
  configSchema: import("openclaw/plugin-sdk/plugin-entry").OpenClawPluginConfigSchema;
  register: NonNullable<OpenClawPluginDefinition["register"]>;
} & Pick<OpenClawPluginDefinition, "kind">;
export default _default;
