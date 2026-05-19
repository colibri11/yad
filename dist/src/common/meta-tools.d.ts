export interface MetaInfo {
    version: string;
    enabledServices: string[];
}
export declare function createMetaTools(info: MetaInfo): {
    name: string;
    description: string;
    parameters: import("@sinclair/typebox").TObject<{}>;
    execute(_id: string, _params: Record<string, unknown>): Promise<{
        content: {
            type: "text";
            text: string;
        }[];
    }>;
}[];
