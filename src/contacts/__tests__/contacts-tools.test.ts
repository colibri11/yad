import { beforeEach, describe, expect, it, vi } from "vitest";
import type { YandexPluginConfig } from "../../common/types.js";

const { mockFetchAllContacts, mockGetContact, mockPutContact, mockDeleteContact } = vi.hoisted(
  () => ({
    mockFetchAllContacts: vi.fn(),
    mockGetContact: vi.fn(),
    mockPutContact: vi.fn(),
    mockDeleteContact: vi.fn(),
  }),
);

vi.mock("../../common/carddav.js", () => ({
  fetchAllContacts: mockFetchAllContacts,
  getContact: mockGetContact,
  putContact: mockPutContact,
  deleteContact: mockDeleteContact,
}));

import { createContactsTools } from "../contacts-tools.js";

const config: YandexPluginConfig = {
  login: "user",
  contacts_app_password: "contacts-secret",
};

function findTool(name: string) {
  const tools = createContactsTools(config);
  return tools.find((t) => t.name === name)!;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("yandex_contacts_list", () => {
  it("returns parsed contacts", async () => {
    mockFetchAllContacts.mockResolvedValue([
      {
        href: "/addressbook/user@yandex.ru/1/c-1.vcf",
        etag: "etag1",
        data: "BEGIN:VCARD\nVERSION:3.0\nFN:Иван Петров\nTEL;TYPE=CELL:+79001234567\nEMAIL;TYPE=INTERNET:ivan@test.com\nUID:c-1\nEND:VCARD",
      },
    ]);

    const tool = findTool("yandex_contacts_list");
    const result = await tool.execute();
    const data = JSON.parse(result.content[0].text);

    expect(data.total).toBe(1);
    expect(data.contacts[0].fullName).toBe("Иван Петров");
    expect(data.contacts[0].phones[0]).toBe("+79001234567");
    expect(data.contacts[0].emails[0]).toBe("ivan@test.com");
  });

  it("returns empty when no contacts", async () => {
    mockFetchAllContacts.mockResolvedValue([]);

    const tool = findTool("yandex_contacts_list");
    const result = await tool.execute();
    const data = JSON.parse(result.content[0].text);

    expect(data.total).toBe(0);
    expect(data.contacts).toEqual([]);
  });
});

describe("yandex_contacts_get", () => {
  it("returns a specific contact", async () => {
    mockGetContact.mockResolvedValue("BEGIN:VCARD\nFN:Alice\nUID:a-1\nEND:VCARD");

    const tool = findTool("yandex_contacts_get");
    const result = await tool.execute("id", { href: "/addressbook/user@yandex.ru/1/a-1.vcf" });
    const data = JSON.parse(result.content[0].text);

    expect(data.fullName).toBe("Alice");
  });
});

describe("yandex_contacts_create", () => {
  it("creates a vCard with all fields", async () => {
    mockPutContact.mockResolvedValue(undefined);

    const tool = findTool("yandex_contacts_create");
    const result = await tool.execute("id", {
      full_name: "Мария Иванова",
      first_name: "Мария",
      last_name: "Иванова",
      email: "maria@test.com",
      phone: "+79009876543",
      organization: "Тест",
      title: "Директор",
    });

    expect(mockPutContact).toHaveBeenCalledOnce();
    const [, filename, vcard] = mockPutContact.mock.calls[0];
    expect(filename).toMatch(/\.vcf$/);
    expect(vcard).toContain("FN:Мария Иванова");
    expect(vcard).toContain("EMAIL;TYPE=INTERNET:maria@test.com");
    expect(vcard).toContain("TEL;TYPE=CELL:+79009876543");
    expect(result.content[0].text).toContain("Мария Иванова");
  });

  it("creates minimal contact with only name", async () => {
    mockPutContact.mockResolvedValue(undefined);

    const tool = findTool("yandex_contacts_create");
    await tool.execute("id", { full_name: "Minimal" });

    const vcard = mockPutContact.mock.calls[0][2];
    expect(vcard).toContain("FN:Minimal");
    expect(vcard).not.toContain("EMAIL");
    expect(vcard).not.toContain("TEL");
  });
});

describe("yandex_contacts_update", () => {
  it("updates existing contact fields", async () => {
    mockGetContact.mockResolvedValue(
      "BEGIN:VCARD\nVERSION:3.0\nFN:Old Name\nUID:u-1\nTEL;TYPE=CELL:+70001112233\nEND:VCARD",
    );
    mockPutContact.mockResolvedValue(undefined);

    const tool = findTool("yandex_contacts_update");
    const result = await tool.execute("id", {
      href: "/addressbook/user@yandex.ru/1/u-1.vcf",
      full_name: "New Name",
      phone: "+79998887766",
    });

    const vcard = mockPutContact.mock.calls[0][2];
    expect(vcard).toContain("FN:New Name");
    expect(vcard).toContain("TEL;TYPE=CELL:+79998887766");
    expect(vcard).toContain("UID:u-1");
    expect(result.content[0].text).toContain("New Name");
  });
});

describe("yandex_contacts_delete", () => {
  it("deletes contact by href", async () => {
    mockDeleteContact.mockResolvedValue(undefined);

    const tool = findTool("yandex_contacts_delete");
    await tool.execute("id", { href: "/addressbook/user@yandex.ru/1/c-1.vcf" });

    expect(mockDeleteContact).toHaveBeenCalledWith(
      expect.objectContaining({ login: "user@yandex.ru" }),
      "/addressbook/user@yandex.ru/1/c-1.vcf",
    );
  });
});
