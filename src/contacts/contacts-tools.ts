import { Type } from "@sinclair/typebox";
import { createDAVClient, type DAVAddressBook } from "tsdav";
import type { YandexPluginConfig } from "../common/types.js";
import { jsonResult, requirePassword, resolveLogin, textResult } from "../common/types.js";
import { parseVCard } from "../common/vcard.js";

const CARDDAV_URL = "https://carddav.yandex.ru";

async function createCardDavClient(config: YandexPluginConfig) {
  return createDAVClient({
    serverUrl: CARDDAV_URL,
    credentials: {
      username: resolveLogin(config.login),
      password: requirePassword(config, "contacts"),
    },
    authMethod: "Basic",
    defaultAccountType: "carddav",
  });
}

export function createContactsTools(config: YandexPluginConfig) {
  return [
    {
      name: "yandex_contacts_list",
      description:
        "List all contacts from Yandex.Contacts address book. " +
        "Returns name, phones, emails for each contact.",
      parameters: Type.Object(
        {
          address_book_url: Type.Optional(
            Type.String({
              description: "Address book URL. If omitted, uses the first address book.",
            }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { address_book_url?: string }) {
        const client = await createCardDavClient(config);
        let addressBook: DAVAddressBook;

        if (params.address_book_url) {
          addressBook = { url: params.address_book_url } as DAVAddressBook;
        } else {
          const books = await client.fetchAddressBooks();
          if (books.length === 0) throw new Error("No address books found");
          addressBook = books[0];
        }

        const vcards = await client.fetchVCards({ addressBook });

        const contacts = vcards
          .filter((v) => v.data)
          .map((v) => ({
            ...parseVCard(v.data!),
            url: v.url,
            etag: v.etag,
          }));

        return jsonResult({ total: contacts.length, contacts });
      },
    },
    {
      name: "yandex_contacts_get",
      description: "Get a specific contact by URL from Yandex.Contacts.",
      parameters: Type.Object(
        {
          contact_url: Type.String({ description: "Contact URL from yandex_contacts_list" }),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { contact_url: string }) {
        const client = await createCardDavClient(config);
        const bookUrl = params.contact_url.replace(/[^/]+\.vcf$/, "");
        const vcards = await client.fetchVCards({
          addressBook: { url: bookUrl } as DAVAddressBook,
        });
        const card = vcards.find((v) => v.url === params.contact_url);
        if (!card?.data) throw new Error(`Contact not found: ${params.contact_url}`);
        return jsonResult(parseVCard(card.data));
      },
    },
    {
      name: "yandex_contacts_create",
      description: "Create a new contact in Yandex.Contacts.",
      parameters: Type.Object(
        {
          full_name: Type.String({ description: "Full display name" }),
          last_name: Type.Optional(Type.String({ description: "Last name" })),
          first_name: Type.Optional(Type.String({ description: "First name" })),
          middle_name: Type.Optional(Type.String({ description: "Middle name" })),
          email: Type.Optional(Type.String({ description: "Email address" })),
          phone: Type.Optional(Type.String({ description: "Phone number" })),
          organization: Type.Optional(Type.String({ description: "Organization" })),
          title: Type.Optional(Type.String({ description: "Job title" })),
          note: Type.Optional(Type.String({ description: "Note" })),
          address_book_url: Type.Optional(
            Type.String({ description: "Address book URL. If omitted, uses the first." }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(
        _id: string,
        params: {
          full_name: string;
          last_name?: string;
          first_name?: string;
          middle_name?: string;
          email?: string;
          phone?: string;
          organization?: string;
          title?: string;
          note?: string;
          address_book_url?: string;
        },
      ) {
        const client = await createCardDavClient(config);
        let addressBook: DAVAddressBook;

        if (params.address_book_url) {
          addressBook = { url: params.address_book_url } as DAVAddressBook;
        } else {
          const books = await client.fetchAddressBooks();
          if (books.length === 0) throw new Error("No address books found");
          addressBook = books[0];
        }

        const uid = crypto.randomUUID();
        const lastName = params.last_name || "";
        const firstName = params.first_name || "";
        const middleName = params.middle_name || "";

        const lines = [
          "BEGIN:VCARD",
          "VERSION:3.0",
          `UID:${uid}`,
          `FN:${params.full_name}`,
          `N:${lastName};${firstName};${middleName};;`,
          params.email ? `EMAIL;TYPE=INTERNET:${params.email}` : "",
          params.phone ? `TEL;TYPE=CELL:${params.phone}` : "",
          params.organization ? `ORG:${params.organization}` : "",
          params.title ? `TITLE:${params.title}` : "",
          params.note ? `NOTE:${params.note}` : "",
          "END:VCARD",
        ]
          .filter(Boolean)
          .join("\r\n");

        await client.createVCard({
          addressBook,
          filename: `${uid}.vcf`,
          vCardString: lines,
        });

        return textResult(`Contact created: "${params.full_name}"`);
      },
    },
    {
      name: "yandex_contacts_update",
      description:
        "Update an existing contact in Yandex.Contacts. " +
        "Requires the contact URL from yandex_contacts_list.",
      parameters: Type.Object(
        {
          contact_url: Type.String({ description: "Contact URL from yandex_contacts_list" }),
          full_name: Type.Optional(Type.String({ description: "New full name" })),
          last_name: Type.Optional(Type.String({ description: "New last name" })),
          first_name: Type.Optional(Type.String({ description: "New first name" })),
          email: Type.Optional(Type.String({ description: "New email" })),
          phone: Type.Optional(Type.String({ description: "New phone" })),
          organization: Type.Optional(Type.String({ description: "New organization" })),
          title: Type.Optional(Type.String({ description: "New job title" })),
          note: Type.Optional(Type.String({ description: "New note" })),
        },
        { additionalProperties: false },
      ),
      async execute(
        _id: string,
        params: {
          contact_url: string;
          full_name?: string;
          last_name?: string;
          first_name?: string;
          email?: string;
          phone?: string;
          organization?: string;
          title?: string;
          note?: string;
        },
      ) {
        const client = await createCardDavClient(config);

        // Fetch current contact
        const bookUrl = params.contact_url.replace(/[^/]+\.vcf$/, "");
        const vcards = await client.fetchVCards({
          addressBook: { url: bookUrl } as DAVAddressBook,
        });
        const existing = vcards.find((v) => v.url === params.contact_url);
        if (!existing?.data) throw new Error(`Contact not found: ${params.contact_url}`);

        const current = parseVCard(existing.data);
        const uid = current.uid || crypto.randomUUID();

        const lines = [
          "BEGIN:VCARD",
          "VERSION:3.0",
          `UID:${uid}`,
          `FN:${params.full_name ?? current.fullName}`,
          `N:${params.last_name ?? ""};;${params.first_name ?? ""};;`,
          (params.email ?? current.emails[0])
            ? `EMAIL;TYPE=INTERNET:${params.email ?? current.emails[0]}`
            : "",
          (params.phone ?? current.phones[0])
            ? `TEL;TYPE=CELL:${params.phone ?? current.phones[0]}`
            : "",
          (params.organization ?? current.organization)
            ? `ORG:${params.organization ?? current.organization}`
            : "",
          (params.title ?? current.title) ? `TITLE:${params.title ?? current.title}` : "",
          (params.note ?? current.note) ? `NOTE:${params.note ?? current.note}` : "",
          "END:VCARD",
        ]
          .filter(Boolean)
          .join("\r\n");

        await client.updateVCard({
          vCard: {
            url: params.contact_url,
            data: lines,
            etag: existing.etag,
          },
        });

        return textResult(`Contact updated: "${params.full_name ?? current.fullName}"`);
      },
    },
    {
      name: "yandex_contacts_delete",
      description: "Delete a contact from Yandex.Contacts.",
      parameters: Type.Object(
        {
          contact_url: Type.String({ description: "Contact URL from yandex_contacts_list" }),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { contact_url: string }) {
        const client = await createCardDavClient(config);
        await client.deleteVCard({
          vCard: { url: params.contact_url, etag: "" },
        });
        return textResult(`Contact deleted: ${params.contact_url}`);
      },
    },
  ];
}
