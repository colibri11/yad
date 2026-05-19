import type { YandexPluginConfig } from "../common/types.js";
export declare function createMailTools(config: YandexPluginConfig): ({
    name: string;
    description: string;
    parameters: import("@sinclair/typebox").TObject<{
        folder: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        limit: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    }>;
    execute(_id: string, params: {
        folder?: string;
        limit?: number;
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
        uid: import("@sinclair/typebox").TInteger;
        folder: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>;
    execute(_id: string, params: {
        uid: number;
        folder?: string;
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
        to: import("@sinclair/typebox").TString;
        subject: import("@sinclair/typebox").TString;
        text: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        html: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        cc: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        bcc: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        attachments: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            filename: import("@sinclair/typebox").TString;
            path: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            content: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        }>>>;
    }>;
    execute(_id: string, params: {
        to: string;
        subject: string;
        text?: string;
        html?: string;
        cc?: string;
        bcc?: string;
        attachments?: Array<{
            filename: string;
            path?: string;
            content?: string;
        }>;
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
        uid: import("@sinclair/typebox").TInteger;
        filename: import("@sinclair/typebox").TString;
        index: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
        folder: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>;
    execute(_id: string, params: {
        uid: number;
        filename: string;
        index?: number;
        folder?: string;
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
        folder: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        uids: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TInteger>;
    }>;
    execute(_id: string, params: {
        folder?: string;
        uids: number[];
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
        folder: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        uids: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TInteger>;
        seen: import("@sinclair/typebox").TBoolean;
    }>;
    execute(_id: string, params: {
        folder?: string;
        uids: number[];
        seen: boolean;
    }): Promise<{
        content: {
            type: "text";
            text: string;
        }[];
    }>;
})[];
