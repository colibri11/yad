/**
 * Lightweight CardDAV client for Yandex.Contacts.
 * Uses native fetch — no tsdav dependency.
 *
 * Yandex CardDAV quirks:
 * - Does NOT support addressbook-query REPORT (returns 403)
 * - PROPFIND Depth:1 on empty address book returns 404
 * - PROPFIND Depth:1 works when address book has contacts
 * - PUT creates/updates contacts, DELETE removes them
 * - Address book path: /addressbook/{login}/1/
 */
export interface CardDavAuth {
    login: string;
    password: string;
}
export interface CardDavContact {
    href: string;
    etag: string;
    data?: string;
}
/** Discover address book URL and display name */
export declare function discoverAddressBooks(auth: CardDavAuth): Promise<Array<{
    url: string;
    displayName: string;
}>>;
/** List contacts in address book via PROPFIND Depth:1 */
export declare function listContacts(auth: CardDavAuth): Promise<CardDavContact[]>;
/** GET a single contact vCard */
export declare function getContact(auth: CardDavAuth, href: string): Promise<string>;
/** Fetch all contacts with their vCard data */
export declare function fetchAllContacts(auth: CardDavAuth): Promise<CardDavContact[]>;
/** PUT — create or update a contact */
export declare function putContact(auth: CardDavAuth, filename: string, vcard: string, etag?: string): Promise<void>;
/** PUT — update a contact by its full href */
export declare function updateContact(auth: CardDavAuth, href: string, vcard: string, etag?: string): Promise<void>;
/** DELETE — remove a contact */
export declare function deleteContact(auth: CardDavAuth, href: string): Promise<void>;
