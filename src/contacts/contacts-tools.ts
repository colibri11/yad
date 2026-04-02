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
      name: "yad_contacts_list",
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
      name: "yad_contacts_get",
      description: "Get a specific contact by href from Yandex.Contacts.",
      parameters: Type.Object(
        {
          href: Type.String({ description: "Contact href from yad_contacts_list" }),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { href: string }) {
        const data = await carddav.getContact(auth(), params.href);
        return jsonResult(parseVCard(data));
      },
    },
    {
      name: "yad_contacts_create",
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

        // If only full_name given, split into first/last for N field
        // Yandex ignores FN when N is all-empty
        let lastName = params.last_name || "";
        let firstName = params.first_name || "";
        const middleName = params.middle_name || "";
        if (!lastName && !firstName) {
          const parts = params.full_name.trim().split(/\s+/);
          if (parts.length >= 2) {
            lastName = parts[0];
            firstName = parts.slice(1).join(" ");
          } else {
            firstName = parts[0] || "";
          }
        }

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

        await carddav.putContact(auth(), `${uid}.vcf`, lines);
        return textResult(`Contact created: "${params.full_name}"`);
      },
    },
    {
      name: "yad_contacts_update",
      description:
        "Update an existing contact in Yandex.Contacts. " +
        "Requires the contact href from yad_contacts_list.",
      parameters: Type.Object(
        {
          href: Type.String({ description: "Contact href from yad_contacts_list" }),
          full_name: Type.Optional(Type.String({ description: "New full name" })),
          last_name: Type.Optional(Type.String({ description: "New last name" })),
          first_name: Type.Optional(Type.String({ description: "New first name" })),
          middle_name: Type.Optional(Type.String({ description: "New middle name" })),
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
          middle_name?: string;
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

        // Parse existing N field: last;first;middle;prefix;suffix
        const nParts = (current.name || ";;;;").split(";");
        const lastName = params.last_name ?? nParts[0] ?? "";
        const firstName = params.first_name ?? nParts[1] ?? "";
        const middleName = params.middle_name ?? nParts[2] ?? "";

        const lines = [
          "BEGIN:VCARD",
          "VERSION:3.0",
          `UID:${uid}`,
          `FN:${params.full_name ?? current.fullName}`,
          `N:${lastName};${firstName};${middleName};;`,
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

        await carddav.updateContact(a, params.href, lines);
        return textResult(`Contact updated: "${params.full_name ?? current.fullName}"`);
      },
    },
    {
      name: "yad_contacts_delete",
      description: "Delete a contact from Yandex.Contacts.",
      parameters: Type.Object(
        {
          href: Type.String({ description: "Contact href from yad_contacts_list" }),
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
