/** Minimal logger interface — compatible with OpenClaw PluginLogger and console. */
export interface Logger {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export interface YandexPluginConfig {
  login: string;
  mail_app_password?: string;
  calendar_app_password?: string;
  disk_app_password?: string;
  contacts_app_password?: string;
  mail_idle_agent_id?: string;
  mail_idle_folder?: string;
}

export function resolveLogin(login: string): string {
  if (login.includes("@")) return login;
  return `${login}@yandex.ru`;
}

export function requirePassword(
  config: YandexPluginConfig,
  service: "mail" | "calendar" | "disk" | "contacts",
): string {
  const key = `${service}_app_password` as const;
  const password = config[key];
  if (!password || typeof password !== "string") {
    const typeNames: Record<string, string> = {
      mail: "Почта",
      calendar: "Календари",
      disk: "Файлы",
      contacts: "Контакты",
    };
    throw new Error(
      `App password for ${service} is not configured. ` +
        `Create one at https://id.yandex.ru/security/app-passwords (type: "${typeNames[service]}") ` +
        `and set it in the plugin config as "${key}".`,
    );
  }
  return password;
}

export function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function jsonResult(data: unknown) {
  return textResult(JSON.stringify(data, null, 2));
}

export function isLikelyText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  let nullCount = 0;
  for (const byte of sample) {
    if (byte === 0) nullCount++;
  }
  return nullCount === 0;
}
