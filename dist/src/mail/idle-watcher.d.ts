import type { Logger, YandexPluginConfig } from "../common/types.js";
export interface MailEnvelope {
  uid: number;
  from: string;
  subject: string;
  date: string;
  folder: string;
}
export interface IdleWatcherOptions {
  config: YandexPluginConfig;
  logger: Logger;
  notifyAgent: (envelope: MailEnvelope) => Promise<void>;
  folder: string;
}
export declare function startIdleWatcher(opts: IdleWatcherOptions): {
  stop: () => Promise<void>;
};
