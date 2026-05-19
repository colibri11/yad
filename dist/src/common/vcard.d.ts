/** Parse basic contact info from vCard text */
export declare function parseVCard(vcard: string): {
    fullName: string;
    name: string | undefined;
    phones: string[];
    emails: string[];
    organization: string | undefined;
    title: string | undefined;
    note: string | undefined;
    uid: string | undefined;
};
