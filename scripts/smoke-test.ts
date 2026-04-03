/**
 * Smoke test — проверка реальных подключений к Яндекс-сервисам.
 *
 * Использование:
 *   export YANDEX_LOGIN="user@yandex.ru"
 *   export YANDEX_DISK_PASSWORD="xxxx-xxxx-xxxx-xxxx"
 *   export YANDEX_MAIL_PASSWORD="xxxx-xxxx-xxxx-xxxx"
 *   export YANDEX_CALENDAR_PASSWORD="xxxx-xxxx-xxxx-xxxx"
 *   export YANDEX_CONTACTS_PASSWORD="xxxx-xxxx-xxxx-xxxx"
 *
 *   npx tsx scripts/smoke-test.ts
 *
 * Можно задать только часть паролей — тесты для ненастроенных сервисов будут пропущены.
 */

import type { YandexPluginConfig } from "../src/common/types.js";

const config: YandexPluginConfig = {
  login: process.env.YANDEX_LOGIN || "",
  disk_app_password: process.env.YANDEX_DISK_PASSWORD,
  mail_app_password: process.env.YANDEX_MAIL_PASSWORD,
  calendar_app_password: process.env.YANDEX_CALENDAR_PASSWORD,
  contacts_app_password: process.env.YANDEX_CONTACTS_PASSWORD,
};

if (!config.login) {
  console.error("❌ YANDEX_LOGIN не задан. Установите переменные окружения.");
  console.error("   export YANDEX_LOGIN=user@yandex.ru");
  process.exit(1);
}

console.log(`\n🔑 Login: ${config.login}\n`);

// --- Helpers ---

type Tool = {
  name: string;
  execute: (...args: unknown[]) => Promise<{ content: { text: string }[] }>;
};

function findTool(tools: Tool[], name: string): Tool {
  const t = tools.find((t) => t.name === name);
  if (!t) throw new Error(`Tool ${name} not found`);
  return t;
}

async function run(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${label}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ❌ ${label}: ${msg}`);
  }
}

// --- Disk ---

if (config.disk_app_password) {
  console.log("📁 Яндекс.Диск (WebDAV)");
  const { createDiskTools } = await import("../src/disk/disk-tools.js");
  const tools = createDiskTools(config) as Tool[];

  await run("list /", async () => {
    const r = await findTool(tools, "yad_disk_list").execute("t", { path: "/" });
    const items = JSON.parse(r.content[0].text);
    console.log(`    Файлов/папок в корне: ${items.length}`);
  });

  await run("mkdir + upload + download + delete", async () => {
    const testDir = `/openclaw-test-${Date.now()}`;
    const testFile = `${testDir}/hello.txt`;

    await findTool(tools, "yad_disk_mkdir").execute("t", { path: testDir });
    await findTool(tools, "yad_disk_upload").execute("t", {
      path: testFile,
      content: "Hello from OpenClaw smoke test!",
    });

    const r = await findTool(tools, "yad_disk_download").execute("t", { path: testFile });
    const text = r.content[0].text;
    if (!text.includes("Hello from OpenClaw")) throw new Error("Content mismatch");

    await findTool(tools, "yad_disk_delete").execute("t", { path: testDir });
    console.log(`    Создал, загрузил, скачал и удалил ${testFile}`);
  });
} else {
  console.log("📁 Яндекс.Диск — пропущен (YANDEX_DISK_PASSWORD не задан)");
}

// --- Mail ---

if (config.mail_app_password) {
  console.log("\n📧 Яндекс.Почта (IMAP/SMTP)");
  const { createMailTools } = await import("../src/mail/mail-tools.js");
  const tools = createMailTools(config) as Tool[];

  await run("list INBOX", async () => {
    const r = await findTool(tools, "yad_mail_list").execute("t", { folder: "INBOX", limit: 5 });
    const data = JSON.parse(r.content[0].text);
    console.log(`    Писем в INBOX: ${data.total}, показано: ${data.showing}`);
  });

  await run("get attachment", async () => {
    // Читаем последние письма и ищем первое с вложением
    const listR = await findTool(tools, "yad_mail_list").execute("t", { folder: "INBOX", limit: 20 });
    const listData = JSON.parse(listR.content[0].text);

    let attachment: { filename: string; contentType: string; size: number } | null = null;
    let msgUid: number | null = null;

    for (const msg of listData.messages) {
      const readR = await findTool(tools, "yad_mail_read").execute("t", { uid: msg.uid });
      const readData = JSON.parse(readR.content[0].text);
      if (readData.attachments?.length > 0) {
        attachment = readData.attachments[0];
        msgUid = msg.uid;
        break;
      }
    }

    if (!attachment || !msgUid) {
      console.log("    Нет писем с вложениями в последних 20 — пропускаем");
      return;
    }

    console.log(`    Письмо UID ${msgUid}, вложение: ${attachment.filename} (${attachment.contentType}, ${attachment.size} bytes)`);

    const r = await findTool(tools, "yad_mail_get_attachment").execute("t", {
      uid: msgUid,
      filename: attachment.filename,
    });
    const data = JSON.parse(r.content[0].text);

    if (!data.content || data.content.length === 0) {
      throw new Error("Attachment content is empty");
    }
    if (data.filename !== attachment.filename) {
      throw new Error(`Filename mismatch: ${data.filename} !== ${attachment.filename}`);
    }
    if (data.encoding !== "utf-8" && data.encoding !== "base64") {
      throw new Error(`Unexpected encoding: ${data.encoding}`);
    }
    console.log(`    Содержимое получено: encoding=${data.encoding}, length=${data.content.length}`);
  });

  await run("search recent", async () => {
    const since = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
    const r = await findTool(tools, "yad_mail_search").execute("t", { since, limit: 3 });
    const data = JSON.parse(r.content[0].text);
    console.log(`    Найдено за неделю: ${data.totalMatches}`);
  });
} else {
  console.log("\n📧 Яндекс.Почта — пропущена (YANDEX_MAIL_PASSWORD не задан)");
}

// --- Calendar ---

if (config.calendar_app_password) {
  console.log("\n📅 Яндекс.Календарь (CalDAV)");
  const { createCalendarTools } = await import("../src/calendar/calendar-tools.js");
  const tools = createCalendarTools(config) as Tool[];

  await run("list calendars", async () => {
    const r = await findTool(tools, "yad_calendar_list").execute();
    const cals = JSON.parse(r.content[0].text);
    console.log(`    Календарей: ${cals.length}`);
    for (const c of cals) console.log(`      - ${c.displayName || c.url}`);
  });

  await run("list events (next 30 days)", async () => {
    const start = new Date().toISOString();
    const end = new Date(Date.now() + 30 * 86400000).toISOString();
    const r = await findTool(tools, "yad_calendar_events").execute("t", { start, end });
    const events = JSON.parse(r.content[0].text);
    console.log(`    Событий: ${events.length}`);
  });

  await run("create + read + delete event (DTSTART round-trip)", async () => {
    const now = new Date();
    const startISO = new Date(now.getTime() + 3600000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const endISO = new Date(now.getTime() + 7200000).toISOString().replace(/\.\d{3}Z$/, "Z");

    // Create
    await findTool(tools, "yad_calendar_create_event").execute("t", {
      summary: "Smoke Test Event",
      start: startISO,
      end: endISO,
      description: "Temporary smoke test",
    });
    console.log("    Событие создано");

    // Read back
    const searchStart = new Date(now.getTime() - 3600000).toISOString();
    const searchEnd = new Date(now.getTime() + 86400000).toISOString();
    const r = await findTool(tools, "yad_calendar_events").execute("t", {
      start: searchStart,
      end: searchEnd,
    });
    const events = JSON.parse(r.content[0].text);
    const created = events.find((e: { summary: string }) => e.summary === "Smoke Test Event");
    if (!created) throw new Error("Created event not found in list");

    if (created.dtstart?.includes("16010101")) {
      throw new Error(`DTSTART is broken: ${created.dtstart} (expected near ${startISO})`);
    }
    console.log(`    DTSTART: ${created.dtstart} — OK`);
    console.log(`    DTEND:   ${created.dtend}`);

    // Delete
    await findTool(tools, "yad_calendar_delete_event").execute("t", {
      event_url: created.url,
    });
    console.log("    Событие удалено");
  });
} else {
  console.log("\n📅 Яндекс.Календарь — пропущен (YANDEX_CALENDAR_PASSWORD не задан)");
}

// --- Contacts ---

if (config.contacts_app_password) {
  console.log("\n👤 Яндекс.Контакты (CardDAV)");
  const { createContactsTools } = await import("../src/contacts/contacts-tools.js");
  const tools = createContactsTools(config) as Tool[];

  await run("list", async () => {
    const r = await findTool(tools, "yad_contacts_list").execute("t", {});
    const data = JSON.parse(r.content[0].text);
    console.log(`    Контактов: ${data.total}`);
  });

  await run("create + get + delete via tool (name round-trip)", async () => {
    // Create contact via tool
    await findTool(tools, "yad_contacts_create").execute("t", {
      full_name: "Smoke Test Contact",
      phone: "+70000000001",
      note: "yad-smoke-test-marker",
    });
    console.log("    Контакт создан через tool");

    // Wait for Yandex indexing
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // List and find
    const r = await findTool(tools, "yad_contacts_list").execute("t", {});
    const data = JSON.parse(r.content[0].text);
    const found = data.contacts.find((c: { note: string }) => c.note === "yad-smoke-test-marker");

    if (found) {
      // Verify name round-trip
      if (found.fullName.includes("(no name)")) {
        throw new Error(`fullName is broken: "${found.fullName}"`);
      }
      console.log(`    fullName: "${found.fullName}"`);
      console.log(`    N: "${found.name}"`);

      // Delete
      await findTool(tools, "yad_contacts_delete").execute("t", { href: found.href });
      console.log("    Контакт удалён");
    } else {
      console.log("    Контакт не найден в списке (Yandex indexing delay) — пропускаем проверку");
      // Try to clean up via direct API
      const { resolveLogin, requirePassword } = await import("../src/common/types.js");
      const carddav = await import("../src/common/carddav.js");
      const a = {
        login: resolveLogin(config.login),
        password: requirePassword(config, "contacts"),
      };
      const contacts = await carddav.fetchAllContacts(a);
      const target = contacts.find((c) => c.data?.includes("yad-smoke-test-marker"));
      if (target) await carddav.deleteContact(a, target.href);
    }
  });

  await run("create + get + delete (direct)", async () => {
    // Используем CardDAV-клиент напрямую — не зависим от задержки индексации PROPFIND
    const { resolveLogin, requirePassword } = await import("../src/common/types.js");
    const carddav = await import("../src/common/carddav.js");
    const { parseVCard } = await import("../src/common/vcard.js");

    const a = {
      login: resolveLogin(config.login),
      password: requirePassword(config, "contacts"),
    };

    const uid = `smoke-test-${Date.now()}`;
    const vcard = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `UID:${uid}`,
      "FN:OpenClaw Smoke Test",
      "N:Test;Smoke;;;",
      "TEL;TYPE=CELL:+70000000000",
      "EMAIL;TYPE=INTERNET:smoke@example.com",
      "END:VCARD",
    ].join("\r\n");

    await carddav.putContact(a, `${uid}.vcf`, vcard);
    console.log("    Контакт создан");

    // GET напрямую по известному href
    const href = `/addressbook/${encodeURIComponent(a.login)}/1/${uid}.vcf`;
    const data = await carddav.getContact(a, href);
    const parsed = parseVCard(data);
    if (parsed.phones[0] !== "+70000000000") throw new Error("Phone mismatch");
    console.log("    GET контакта — OK");

    // Удаляем
    await carddav.deleteContact(a, href);
    console.log("    Контакт удалён");
  });
} else {
  console.log("\n👤 Яндекс.Контакты — пропущены (YANDEX_CONTACTS_PASSWORD не задан)");
}

console.log("\n🏁 Smoke test завершён.\n");
