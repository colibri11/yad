import { Type } from "@sinclair/typebox";
import * as carddav from "../common/carddav.js";
import type { YandexPluginConfig } from "../common/types.js";
import { jsonResult, requirePassword, resolveLogin, textResult } from "../common/types.js";
import { parseVCard } from "../common/vcard.js";

function contactsAuth(config: YandexPluginConfig): carddav.CardDavAuth {
  return {
    login: resolveLogin(config.login),
    password: requirePassword(config, "contacts"),
  };
}

export function createContactsTools(config: YandexPluginConfig) {
  const auth = () => contactsAuth(config);

  return [
    {
      name: "yandex_contacts_list",
      description:
        "List all contacts from Yandex.Contacts address book. " +
        "Returns name, phones, emails for each contact.",
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute() {
        const contacts = await carddav.fetchAllContacts(auth());
        const parsed = contacts
          .filter((c) => c.data)
          .map((c) => ({
            ...parseVCard(c.data!),
            href: c.href,
            etag: c.etag,
          }));
        return jsonResult({ total: parsed.length, contacts: parsed });
      },
    },
    {
      name: "yandex_contacts_get",
      description: "Get a specific contact by href from Yandex.Contacts.",
      parameters: Type.Object(
        {
          href: Type.String({ description: "Contact href from yandex_contacts_list" }),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { href: string }) {
        const data = await carddav.getContact(auth(), params.href);
        return jsonResult(parseVCard(data));
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
        },
      ) {
        const uid = crypto.randomUUID();
        const lines = [
          "BEGIN:VCARD",
          "VERSION:3.0",
          `UID:${uid}`,
          `FN:${params.full_name}`,
          `N:${params.last_name || ""};${params.first_name || ""};${params.middle_name || ""};;`,
          params.email ? `EMAIL;TYPE=INTERNET:${params.email}` : "",
          params.phone ? `TEL;TYPE=CELL:${params.phone}` : "",
          params.organization ? `ORG:${params.organization}` : "",
          params.title ? `TITLE:${params.title}` : "",
          params.note ? `NOTE:${params.note}` : "",
          "END:VCARD",
        ]
          .filter(Boolean)
          .join("\r\n");

        await carddav.putContact(auth(), `${uid}.vcf`, lines);
        return textResult(`Contact created: "${params.full_name}"`);
      },
    },
    {
      name: "yandex_contacts_update",
      description:
        "Update an existing contact in Yandex.Contacts. " +
        "Requires the contact href from yandex_contacts_list.",
      parameters: Type.Object(
        {
          href: Type.String({ description: "Contact href from yandex_contacts_list" }),
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
          href: string;
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
        const a = auth();
        const data = await carddav.getContact(a, params.href);
        const current = parseVCard(data);
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

        const filename = params.href.split("/").pop() || `${uid}.vcf`;
        await carddav.putContact(a, filename, lines);
        return textResult(`Contact updated: "${params.full_name ?? current.fullName}"`);
      },
    },
    {
      name: "yandex_contacts_delete",
      description: "Delete a contact from Yandex.Contacts.",
      parameters: Type.Object(
        {
          href: Type.String({ description: "Contact href from yandex_contacts_list" }),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { href: string }) {
        await carddav.deleteContact(auth(), params.href);
        return textResult(`Contact deleted: ${params.href}`);
      },
    },
  ];
}
