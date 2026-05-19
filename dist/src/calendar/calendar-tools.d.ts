import type { YandexPluginConfig } from "../common/types.js";
export declare function createCalendarTools(config: YandexPluginConfig): ({
    name: string;
    description: string;
    parameters: import("@sinclair/typebox").TObject<{}>;
    execute(): Promise<{
        content: {
            type: "text";
            text: string;
        }[];
    }>;
} | {
    name: string;
    description: string;
    parameters: import("@sinclair/typebox").TObject<{
        calendar_url: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        start: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        end: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>;
    execute(_id: string, params: {
        calendar_url?: string;
        start?: string;
        end?: string;
    }): Promise<{
        content: {
            type: "text";
            text: string;
        }[];
    }>;
} | {
    name: string;
    description: string;
    parameters: import("@sinclair/typebox").TObject<{
        summary: import("@sinclair/typebox").TString;
        start: import("@sinclair/typebox").TString;
        end: import("@sinclair/typebox").TString;
        description: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        location: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        calendar_url: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>;
    execute(_id: string, params: {
        summary: string;
        start: string;
        end: string;
        description?: string;
        location?: string;
        calendar_url?: string;
    }): Promise<{
        content: {
            type: "text";
            text: string;
        }[];
    }>;
} | {
    name: string;
    description: string;
    parameters: import("@sinclair/typebox").TObject<{
        event_url: import("@sinclair/typebox").TString;
    }>;
    execute(_id: string, params: {
        event_url: string;
    }): Promise<{
        content: {
            type: "text";
            text: string;
        }[];
    }>;
})[];
