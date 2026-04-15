import { Type } from "@sinclair/typebox";
import { jsonResult } from "./types.js";

export interface MetaInfo {
  version: string;
  enabledServices: string[];
}

export function createMetaTools(info: MetaInfo) {
  return [
    {
      name: "yad_version",
      description:
        "Return runtime info about this yad instance: plugin version, " +
        "enabled Yandex services, process start time, uptime, and pid. " +
        "Use this to verify which build is actually running — especially " +
        "during development or after an upgrade, when cached or stale " +
        "binaries would otherwise be indistinguishable from a fresh install.",
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute(_id: string, _params: Record<string, unknown>) {
        const uptimeSeconds = Math.round(process.uptime());
        const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
        return jsonResult({
          version: info.version,
          enabledServices: info.enabledServices,
          startedAt,
          uptimeSeconds,
          pid: process.pid,
        });
      },
    },
  ];
}
