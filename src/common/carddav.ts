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

const CARDDAV_BASE = "https://carddav.yandex.ru";

export interface CardDavAuth {
  login: string;
  password: string;
}

export interface CardDavContact {
  href: string;
  etag: string;
  data?: string;
}

function authHeader(auth: CardDavAuth): string {
  const encoded = Buffer.from(`${auth.login}:${auth.password}`).toString("base64");
  return `Basic ${encoded}`;
}

function addressBookUrl(login: string): string {
  return `${CARDDAV_BASE}/addressbook/${encodeURIComponent(login)}/1/`;
}

function contactUrl(login: string, filename: string): string {
  return `${CARDDAV_BASE}/addressbook/${encodeURIComponent(login)}/1/${filename}`;
}

/** Discover address book URL and display name */
export async function discoverAddressBooks(
  auth: CardDavAuth,
): Promise<Array<{ url: string; displayName: string }>> {
  const url = `${CARDDAV_BASE}/addressbook/${encodeURIComponent(auth.login)}/`;
  const res = await fetch(url, {
    method: "PROPFIND",
    headers: {
      Authorization: authHeader(auth),
      Depth: "1",
      "Content-Type": "application/xml",
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
  </d:prop>
</d:propfind>`,
  });
  if (!res.ok && res.status !== 207) {
    throw new Error(`CardDAV discover failed: ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();
  const books: Array<{ url: string; displayName: string }> = [];
  const responseRegex = /<D:response>([\s\S]*?)<\/D:response>/g;
  for (let m = responseRegex.exec(xml); m !== null; m = responseRegex.exec(xml)) {
    const block = m[1];
    if (block.includes("addressbook")) {
      const href = extractTag(block, "href") || "";
      const name = extractTag(block, "displayname") || "";
      books.push({ url: `${CARDDAV_BASE}${href}`, displayName: name });
    }
  }
  return books;
}

/** List contacts in address book via PROPFIND Depth:1 */
export async function listContacts(auth: CardDavAuth): Promise<CardDavContact[]> {
  const url = addressBookUrl(auth.login);
  const res = await fetch(url, {
    method: "PROPFIND",
    headers: {
      Authorization: authHeader(auth),
      Depth: "1",
      "Content-Type": "application/xml",
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getetag/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`,
  });

  // Yandex returns 404 for empty address book
  if (res.status === 404) return [];

  if (!res.ok && res.status !== 207) {
    throw new Error(`CardDAV list failed: ${res.status} ${res.statusText}`);
  }

  const xml = await res.text();
  const contacts: CardDavContact[] = [];
  const responseRegex = /<D:response>([\s\S]*?)<\/D:response>/g;
  for (let m = responseRegex.exec(xml); m !== null; m = responseRegex.exec(xml)) {
    const block = m[1];
    // Skip collections (the address book itself)
    if (block.includes("<D:collection") || block.includes("<d:collection")) continue;
    const href = extractTag(block, "href") || "";
    if (!href.endsWith(".vcf")) continue;
    const etag = extractTag(block, "getetag") || "";
    contacts.push({
      href: decodeURIComponent(href),
      etag: etag.replace(/"/g, ""),
    });
  }
  return contacts;
}

/** GET a single contact vCard */
export async function getContact(auth: CardDavAuth, href: string): Promise<string> {
  const url = href.startsWith("http") ? href : `${CARDDAV_BASE}${href}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: authHeader(auth),
      Accept: "text/vcard",
    },
  });
  if (!res.ok) {
    throw new Error(`CardDAV GET ${href} failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/** Fetch all contacts with their vCard data */
export async function fetchAllContacts(auth: CardDavAuth): Promise<CardDavContact[]> {
  const entries = await listContacts(auth);
  const results: CardDavContact[] = [];
  for (const entry of entries) {
    const data = await getContact(auth, entry.href);
    results.push({ ...entry, data });
  }
  return results;
}

/** PUT — create or update a contact */
export async function putContact(
  auth: CardDavAuth,
  filename: string,
  vcard: string,
  etag?: string,
): Promise<void> {
  const url = contactUrl(auth.login, filename);
  const headers: Record<string, string> = {
    Authorization: authHeader(auth),
    "Content-Type": "text/vcard; charset=utf-8",
  };
  if (etag) headers["If-Match"] = `"${etag}"`;

  const res = await fetch(url, { method: "PUT", headers, body: vcard });
  if (!res.ok) {
    throw new Error(`CardDAV PUT ${filename} failed: ${res.status} ${res.statusText}`);
  }
}

/** DELETE — remove a contact */
export async function deleteContact(auth: CardDavAuth, href: string): Promise<void> {
  const url = href.startsWith("http") ? href : `${CARDDAV_BASE}${href}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: authHeader(auth) },
  });
  if (!res.ok) {
    throw new Error(`CardDAV DELETE ${href} failed: ${res.status} ${res.statusText}`);
  }
}

function extractTag(xml: string, tagName: string): string | null {
  const pattern = new RegExp(
    `<(?:[a-zA-Z]+:)?${tagName}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z]+:)?${tagName}>`,
    "i",
  );
  const m = pattern.exec(xml);
  return m ? m[1].trim() : null;
}
