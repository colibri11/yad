import { beforeEach, describe, expect, it, vi } from "vitest";
import type { YandexPluginConfig } from "../../common/types.js";

const {
  mockFetchAddressBooks,
  mockFetchVCards,
  mockCreateVCard,
  mockUpdateVCard,
  mockDeleteVCard,
} = vi.hoisted(() => ({
  mockFetchAddressBooks: vi.fn(),
  mockFetchVCards: vi.fn(),
  mockCreateVCard: vi.fn(),
  mockUpdateVCard: vi.fn(),
  mockDeleteVCard: vi.fn(),
}));

vi.mock("tsdav", () => ({
  createDAVClient: vi.fn().mockResolvedValue({
    fetchAddressBooks: mockFetchAddressBooks,
    fetchVCards: mockFetchVCards,
    createVCard: mockCreateVCard,
    updateVCard: mockUpdateVCard,
    deleteVCard: mockDeleteVCard,
  }),
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
  it("returns parsed contacts from first address book", async () => {
    mockFetchAddressBooks.mockResolvedValue([{ url: "/addressbook/1/" }]);
    mockFetchVCards.mockResolvedValue([
      {
        data: `BEGIN:VCARD\nVERSION:3.0\nFN:Иван Петров\nTEL;TYPE=CELL:+79001234567\nEMAIL;TYPE=INTERNET:ivan@test.com\nUID:c-1\nEND:VCARD`,
        url: "/addressbook/1/c-1.vcf",
        etag: "etag1",
      },
    ]);

    const tool = findTool("yandex_contacts_list");
    const result = await tool.execute("id", {});
    const data = JSON.parse(result.content[0].text);

    expect(data.total).toBe(1);
    expect(data.contacts[0].fullName).toBe("Иван Петров");
    expect(data.contacts[0].phones[0]).toBe("+79001234567");
    expect(data.contacts[0].emails[0]).toBe("ivan@test.com");
  });

  it("uses provided address book URL", async () => {
    mockFetchVCards.mockResolvedValue([]);

    const tool = findTool("yandex_contacts_list");
    await tool.execute("id", { address_book_url: "/custom/book/" });

    expect(mockFetchVCards).toHaveBeenCalledWith({
      addressBook: { url: "/custom/book/" },
    });
    expect(mockFetchAddressBooks).not.toHaveBeenCalled();
  });

  it("throws when no address books found", async () => {
    mockFetchAddressBooks.mockResolvedValue([]);

    const tool = findTool("yandex_contacts_list");
    await expect(tool.execute("id", {})).rejects.toThrow("No address books found");
  });
});

describe("yandex_contacts_get", () => {
  it("returns a specific contact", async () => {
    mockFetchVCards.mockResolvedValue([
      {
        data: `BEGIN:VCARD\nFN:Alice\nUID:a-1\nEND:VCARD`,
        url: "/addressbook/1/a-1.vcf",
        etag: "e1",
      },
    ]);

    const tool = findTool("yandex_contacts_get");
    const result = await tool.execute("id", { contact_url: "/addressbook/1/a-1.vcf" });
    const data = JSON.parse(result.content[0].text);

    expect(data.fullName).toBe("Alice");
  });

  it("throws when contact not found", async () => {
    mockFetchVCards.mockResolvedValue([]);

    const tool = findTool("yandex_contacts_get");
    await expect(tool.execute("id", { contact_url: "/addressbook/1/missing.vcf" })).rejects.toThrow(
      "Contact not found",
    );
  });
});

describe("yandex_contacts_create", () => {
  it("creates a vCard with all fields", async () => {
    mockFetchAddressBooks.mockResolvedValue([{ url: "/addressbook/1/" }]);
    mockCreateVCard.mockResolvedValue(undefined);

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

    expect(mockCreateVCard).toHaveBeenCalledOnce();
    const call = mockCreateVCard.mock.calls[0][0];
    expect(call.vCardString).toContain("FN:Мария Иванова");
    expect(call.vCardString).toContain("EMAIL;TYPE=INTERNET:maria@test.com");
    expect(call.vCardString).toContain("TEL;TYPE=CELL:+79009876543");
    expect(call.vCardString).toContain("ORG:Тест");
    expect(call.filename).toMatch(/\.vcf$/);

    expect(result.content[0].text).toContain("Мария Иванова");
  });

  it("creates minimal contact with only name", async () => {
    mockFetchAddressBooks.mockResolvedValue([{ url: "/addressbook/1/" }]);
    mockCreateVCard.mockResolvedValue(undefined);

    const tool = findTool("yandex_contacts_create");
    await tool.execute("id", { full_name: "Minimal" });

    const card = mockCreateVCard.mock.calls[0][0].vCardString;
    expect(card).toContain("FN:Minimal");
    expect(card).not.toContain("EMAIL");
    expect(card).not.toContain("TEL");
  });
});

describe("yandex_contacts_update", () => {
  it("updates existing contact fields", async () => {
    mockFetchVCards.mockResolvedValue([
      {
        data: `BEGIN:VCARD\nVERSION:3.0\nFN:Old Name\nUID:u-1\nTEL;TYPE=CELL:+70001112233\nEND:VCARD`,
        url: "/addressbook/1/u-1.vcf",
        etag: "etag-old",
      },
    ]);
    mockUpdateVCard.mockResolvedValue(undefined);

    const tool = findTool("yandex_contacts_update");
    const result = await tool.execute("id", {
      contact_url: "/addressbook/1/u-1.vcf",
      full_name: "New Name",
      phone: "+79998887766",
    });

    const call = mockUpdateVCard.mock.calls[0][0];
    expect(call.vCard.data).toContain("FN:New Name");
    expect(call.vCard.data).toContain("TEL;TYPE=CELL:+79998887766");
    expect(call.vCard.data).toContain("UID:u-1");
    expect(result.content[0].text).toContain("New Name");
  });

  it("throws when contact not found", async () => {
    mockFetchVCards.mockResolvedValue([]);

    const tool = findTool("yandex_contacts_update");
    await expect(
      tool.execute("id", { contact_url: "/addressbook/1/missing.vcf", full_name: "X" }),
    ).rejects.toThrow("Contact not found");
  });
});

describe("yandex_contacts_delete", () => {
  it("deletes contact by URL", async () => {
    mockDeleteVCard.mockResolvedValue(undefined);

    const tool = findTool("yandex_contacts_delete");
    await tool.execute("id", { contact_url: "/addressbook/1/c-1.vcf" });

    expect(mockDeleteVCard).toHaveBeenCalledWith({
      vCard: { url: "/addressbook/1/c-1.vcf", etag: "" },
    });
  });
});
