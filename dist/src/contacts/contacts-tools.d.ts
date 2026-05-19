import type { YandexPluginConfig } from "../common/types.js";
export declare function createContactsTools(config: YandexPluginConfig): ({
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
        href: import("@sinclair/typebox").TString;
    }>;
    execute(_id: string, params: {
        href: string;
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
        full_name: import("@sinclair/typebox").TString;
        last_name: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        first_name: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        middle_name: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        email: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        phone: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        organization: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        title: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        note: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>;
    execute(_id: string, params: {
        full_name: string;
        last_name?: string;
        first_name?: string;
        middle_name?: string;
        email?: string;
        phone?: string;
        organization?: string;
        title?: string;
        note?: string;
    }): Promise<{
        content: {
            type: "text";
            text: string;
        }[];
    }>;
})[];
