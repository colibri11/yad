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
