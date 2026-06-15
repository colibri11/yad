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
  /** OAuth token for Yandex.Disk REST API. Required for files > ~10 MB
   * because the WebDAV gateway throttles/drops connections on large bodies.
   * Get one at https://oauth.yandex.ru/. */
  disk_oauth_token?: string;
  mail_idle_agent_id?: string;
  mail_idle_folder?: string;
}
export declare function resolveLogin(login: string): string;
export declare function requirePassword(
  config: YandexPluginConfig,
  service: "mail" | "calendar" | "disk" | "contacts",
): string;
export declare function textResult(text: string): {
  content: {
    type: "text";
    text: string;
  }[];
};
export declare function jsonResult(data: unknown): {
  content: {
    type: "text";
    text: string;
  }[];
};
export declare function isLikelyText(buf: Buffer): boolean;
