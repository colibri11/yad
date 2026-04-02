import { describe, expect, it } from "vitest";
import { parseVCard } from "../vcard.js";

const sampleVCard = `BEGIN:VCARD
VERSION:3.0
UID:contact-001
FN:Иван Петров
N:Петров;Иван;Сергеевич;;
TEL;TYPE=CELL:+79001234567
TEL;TYPE=WORK:+74951234567
EMAIL;TYPE=INTERNET:ivan@example.com
EMAIL;TYPE=WORK:ivan.petrov@company.ru
ORG:ООО Рога и Копыта
TITLE:Главный инженер
NOTE:Важный контакт
END:VCARD`;

describe("parseVCard", () => {
  it("extracts full name", () => {
    expect(parseVCard(sampleVCard).fullName).toBe("Иван Петров");
  });

  it("extracts structured name", () => {
    expect(parseVCard(sampleVCard).name).toBe("Петров;Иван;Сергеевич;;");
  });

  it("extracts all phone numbers", () => {
    const phones = parseVCard(sampleVCard).phones;
    expect(phones).toHaveLength(2);
    expect(phones[0]).toBe("+79001234567");
    expect(phones[1]).toBe("+74951234567");
  });

  it("extracts all emails", () => {
    const emails = parseVCard(sampleVCard).emails;
    expect(emails).toHaveLength(2);
    expect(emails[0]).toBe("ivan@example.com");
    expect(emails[1]).toBe("ivan.petrov@company.ru");
  });

  it("extracts organization", () => {
    expect(parseVCard(sampleVCard).organization).toBe("ООО Рога и Копыта");
  });

  it("extracts title", () => {
    expect(parseVCard(sampleVCard).title).toBe("Главный инженер");
  });

  it("extracts note", () => {
    expect(parseVCard(sampleVCard).note).toBe("Важный контакт");
  });

  it("extracts uid", () => {
    expect(parseVCard(sampleVCard).uid).toBe("contact-001");
  });

  it("returns '(no name)' when FN is missing", () => {
    const minimal = `BEGIN:VCARD
VERSION:3.0
N:;Unknown;;;
END:VCARD`;
    expect(parseVCard(minimal).fullName).toBe("(no name)");
  });

  it("returns empty arrays when no phones or emails", () => {
    const minimal = `BEGIN:VCARD
VERSION:3.0
FN:Nobody
END:VCARD`;
    const c = parseVCard(minimal);
    expect(c.phones).toEqual([]);
    expect(c.emails).toEqual([]);
  });

  it("returns undefined for missing optional fields", () => {
    const minimal = `BEGIN:VCARD
VERSION:3.0
FN:Simple
END:VCARD`;
    const c = parseVCard(minimal);
    expect(c.organization).toBeUndefined();
    expect(c.title).toBeUndefined();
    expect(c.note).toBeUndefined();
  });

  it("handles TEL without TYPE parameter", () => {
    const card = `BEGIN:VCARD
FN:Test
TEL:+79991112233
END:VCARD`;
    const c = parseVCard(card);
    expect(c.phones).toHaveLength(1);
    expect(c.phones[0]).toBe("+79991112233");
  });

  it("handles phone with international prefix containing colons", () => {
    // Edge case: TEL;TYPE=CELL:tel:+79001234567
    const card = `BEGIN:VCARD
FN:Test
TEL;TYPE=CELL:tel:+79001234567
END:VCARD`;
    const c = parseVCard(card);
    expect(c.phones[0]).toBe("tel:+79001234567");
  });

  it("handles folded NOTE field (line continuation)", () => {
    const card = `BEGIN:VCARD
FN:Test
NOTE:This is a very long note that does not fit
 on a single line and continues with a leading space
END:VCARD`;
    const c = parseVCard(card);
    expect(c.note).toBe(
      "This is a very long note that does not fiton a single line and continues with a leading space",
    );
  });
});
