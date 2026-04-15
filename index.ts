// biome-ignore lint/correctness/noUnusedImports: OpenClawPluginDefinition required for tsc default export

import { readFileSync } from "node:fs";
import type { AnyAgentTool, OpenClawPluginDefinition } from "openclaw/plugin-sdk/plugin-entry";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createCalendarTools } from "./src/calendar/calendar-tools.js";
import type { YandexPluginConfig } from "./src/common/types.js";
import { createContactsTools } from "./src/contacts/contacts-tools.js";
import { createDiskTools } from "./src/disk/disk-tools.js";
import { startIdleWatcher } from "./src/mail/idle-watcher.js";
import { createMailTools } from "./src/mail/mail-tools.js";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

export default definePluginEntry({
  id: "yad",
  name: "Yad",
  description:
    `Yandex services plugin v${pkg.version}. ` +
    "Mail (IMAP/SMTP), Calendar (CalDAV), Disk (WebDAV), Contacts (CardDAV). " +
    "All services use app passwords from id.yandex.ru/security/app-passwords.",

  register(api) {
    const config = api.pluginConfig as unknown as YandexPluginConfig;

    if (!config?.login) {
      api.logger.warn(
        "Yandex plugin: login is not configured. " +
          "Set it in the plugin config to enable Yandex services.",
      );
      return;
    }

    const registerTools = (tools: unknown[]) => {
      for (const tool of tools) {
        api.registerTool(tool as AnyAgentTool);
      }
    };

    // Register tools for each service that has an app password configured
    if (config.disk_app_password) {
      registerTools(createDiskTools(config));
      api.logger.info("Yandex Disk tools registered (WebDAV)");
    }

    if (config.mail_app_password) {
      registerTools(createMailTools(config));
      api.logger.info("Yandex Mail tools registered (IMAP/SMTP)");
    }

    if (config.calendar_app_password) {
      registerTools(createCalendarTools(config));
      api.logger.info("Yandex Calendar tools registered (CalDAV)");
    }

    if (config.contacts_app_password) {
      registerTools(createContactsTools(config));
      api.logger.info("Yandex Contacts tools registered (CardDAV)");
    }

    // IMAP IDLE watcher — opt-in via mail_idle_agent_id.
    //
    // The watcher owns a long-lived persistent IMAP connection — it must be
    // a singleton per process regardless of how many times register() is
    // called (multi-agent mode invokes register() once per agent, and the
    // gateway plugin loader may retry on top of that).
    //
    // Tools above are safe to register on every api — each agent has its
    // own tool registry. But registerService for the IDLE watcher must be
    // called exactly once, or we'd get multiple concurrent IMAP IDLE
    // clients fighting over the same mailbox.
    //
    // Symbol.for + globalThis survives across different module graphs /
    // require caches, which is the whole point of a true process singleton.
    const IDLE_REGISTERED_KEY = Symbol.for("yad.idleServiceRegistered");
    const globalStore = globalThis as Record<symbol, unknown>;
    const idleAlreadyRegistered = Boolean(globalStore[IDLE_REGISTERED_KEY]);

    if (config.mail_app_password && config.mail_idle_agent_id && !idleAlreadyRegistered) {
      globalStore[IDLE_REGISTERED_KEY] = true;

      const agentId = config.mail_idle_agent_id;
      const folder = config.mail_idle_folder || "INBOX";
      let watcherHandle: { stop: () => Promise<void> } | null = null;

      api.registerService({
        id: "yad-mail-idle",
        async start(ctx) {
          watcherHandle = startIdleWatcher({
            config,
            logger: ctx.logger,
            folder,
            notifyAgent: async (envelope) => {
              const message = [
                `New email received in ${envelope.folder}.`,
                `From: ${envelope.from}`,
                `Subject: ${envelope.subject}`,
                `Date: ${envelope.date}`,
                `UID: ${envelope.uid}`,
                "",
                `Read this email using yad_mail_read (uid: ${envelope.uid}), extract and process all attachments.`,
              ].join("\n");

              await api.runtime.subagent.run({
                sessionKey: `agent:${agentId}:subagent:mail-idle`,
                message,
              });
            },
          });
        },
        async stop() {
          await watcherHandle?.stop();
          watcherHandle = null;
        },
      });

      api.logger.info(`IDLE watcher registered → agent "${agentId}", folder "${folder}"`);
    }

    const enabled = [
      config.disk_app_password && "Disk",
      config.mail_app_password && "Mail",
      config.calendar_app_password && "Calendar",
      config.contacts_app_password && "Contacts",
    ].filter(Boolean);

    if (enabled.length === 0) {
      api.logger.warn(
        "Yandex plugin: no app passwords configured. " +
          "Create app passwords at https://id.yandex.ru/security/app-passwords " +
          "and add them to the plugin config.",
      );
    } else {
      api.logger.info(`Yandex plugin enabled for: ${enabled.join(", ")}`);
    }
  },
});
