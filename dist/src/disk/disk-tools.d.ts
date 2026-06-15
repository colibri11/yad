import type { YandexPluginConfig } from "../common/types.js";
export declare function createDiskTools(config: YandexPluginConfig): (
  | {
      name: string;
      description: string;
      parameters: import("@sinclair/typebox").TObject<{
        path: import("@sinclair/typebox").TString;
      }>;
      execute(
        _id: string,
        params: {
          path: string;
        },
      ): Promise<{
        content: {
          type: "text";
          text: string;
        }[];
      }>;
    }
  | {
      name: string;
      description: string;
      parameters: import("@sinclair/typebox").TObject<{
        from: import("@sinclair/typebox").TString;
        to: import("@sinclair/typebox").TString;
        overwrite: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
      }>;
      execute(
        _id: string,
        params: {
          from: string;
          to: string;
          overwrite?: boolean;
        },
      ): Promise<{
        content: {
          type: "text";
          text: string;
        }[];
      }>;
    }
)[];
