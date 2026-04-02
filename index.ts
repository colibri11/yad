// biome-ignore lint/correctness/noUnusedImports: OpenClawPluginDefinition required for tsc default export
import type { AnyAgentTool, OpenClawPluginDefinition } from "openclaw/plugin-sdk/plugin-entry";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createCalendarTools } from "./src/calendar/calendar-tools.js";
import type { YandexPluginConfig } from "./src/common/types.js";
import { createContactsTools } from "./src/contacts/contacts-tools.js";
import { createDiskTools } from "./src/disk/disk-tools.js";
import { createMailTools } from "./src/mail/mail-tools.js";

export default definePluginEntry({
  id: "yandex",
  name: "Yandex Services",
  description:
    "Integration with Yandex Mail (IMAP/SMTP), Calendar (CalDAV), " +
    "Disk (WebDAV), and Contacts (CardDAV). " +
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
