/**
 * Smoke test — проверка реальных подключений к Яндекс-сервисам.
 *
 * Использование:
 *   export YANDEX_LOGIN="user@yandex.ru"
 *   export YANDEX_DISK_PASSWORD="xxxx-xxxx-xxxx-xxxx"
 *   export YANDEX_MAIL_PASSWORD="xxxx-xxxx-xxxx-xxxx"
 *   export YANDEX_CALENDAR_PASSWORD="xxxx-xxxx-xxxx-xxxx"
 *   export YANDEX_CONTACTS_PASSWORD="xxxx-xxxx-xxxx-xxxx"
 *   export YANDEX_DISK_OAUTH_TOKEN="y0_xxx..."   # optional, enables REST API tests
 *
 *   npx tsx scripts/smoke-test.ts
 *
 * Можно задать только часть паролей — тесты для ненастроенных сервисов будут пропущены.
 */

import type { YandexPluginConfig } from "../src/common/types.js";

const config: YandexPluginConfig = {
  login: process.env.YANDEX_LOGIN || "",
  disk_app_password: process.env.YANDEX_DISK_PASSWORD,
  disk_oauth_token: process.env.YANDEX_DISK_OAUTH_TOKEN,
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

  await run("mkdir recursive + upload + verify + delete", async () => {
    const ts = Date.now();
    const deepPath = `/openclaw-test-${ts}/level-1/level-2/level-3`;
    const testFile = `${deepPath}/deep.txt`;

    // Create nested folders in one call
    const r = await findTool(tools, "yad_disk_mkdir").execute("t", {
      path: deepPath,
      recursive: true,
    });
    const text = r.content[0].text;
    console.log(`    ${text}`);

    // Verify each level exists
    for (const level of [
      `/openclaw-test-${ts}`,
      `/openclaw-test-${ts}/level-1`,
      `/openclaw-test-${ts}/level-1/level-2`,
      deepPath,
    ]) {
      const info = await findTool(tools, "yad_disk_info").execute("t", { path: level });
      const data = JSON.parse(info.content[0].text);
      if (data.type !== "folder") throw new Error(`${level} is not a folder`);
    }
    console.log("    Все 4 уровня существуют ✓");

    // Upload into the deepest folder
    await findTool(tools, "yad_disk_upload").execute("t", {
      path: testFile,
      content: "Deep nested file",
    });

    const dl = await findTool(tools, "yad_disk_download").execute("t", { path: testFile });
    if (!dl.content[0].text.includes("Deep nested")) throw new Error("Content mismatch");
    console.log("    Upload в глубокую папку ✓");

    // Calling recursive on existing path should report "already exists"
    const r2 = await findTool(tools, "yad_disk_mkdir").execute("t", {
      path: deepPath,
      recursive: true,
    });
    if (!r2.content[0].text.includes("already exists")) {
      throw new Error("Expected 'already exists' for existing path");
    }
    console.log("    Повторный recursive → already exists ✓");

    // Cleanup
    await findTool(tools, "yad_disk_delete").execute("t", { path: `/openclaw-test-${ts}` });
  });

  await run("mkdir recursive + immediate source_path upload (backup scenario)", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");

    const ts = Date.now();
    const remotePath = `/openclaw-test-${ts}/backups/memorybox/2026-04`;
    const remoteFile = `${remotePath}/memorybox-2026-04-04T072305.sql.gz.age`;

    // Create a temp binary file simulating an encrypted backup
    const tmpPath = path.join(os.tmpdir(), `yad-backup-${ts}.sql.gz.age`);
    const original = Buffer.alloc(4096);
    for (let i = 0; i < original.length; i++) original[i] = (i * 13 + 7) % 256;
    fs.writeFileSync(tmpPath, original);

    try {
      // mkdir recursive
      await findTool(tools, "yad_disk_mkdir").execute("t", {
        path: remotePath,
        recursive: true,
      });
      console.log(`    mkdir recursive: ${remotePath}`);

      // Immediate upload via source_path — this is what the agent does
      await findTool(tools, "yad_disk_upload").execute("t", {
        path: remoteFile,
        source_path: tmpPath,
      });
      console.log(`    upload: ${remoteFile}`);

      // Verify
      const r = await findTool(tools, "yad_disk_download").execute("t", { path: remoteFile });
      const raw = r.content[0].text;
      const b64Match = raw.match(/base64\]:\n(.+)$/s);
      if (!b64Match) throw new Error("Expected binary output from download");
      const downloaded = Buffer.from(b64Match[1], "base64");

      if (!downloaded.equals(original)) {
        throw new Error(
          `Binary mismatch: original=${original.length} bytes, downloaded=${downloaded.length} bytes`,
        );
      }
      console.log(`    download + verify: ${original.length} bytes ✓`);

      // Cleanup
      await findTool(tools, "yad_disk_delete").execute("t", {
        path: `/openclaw-test-${ts}`,
      });
    } finally {
      fs.unlinkSync(tmpPath);
    }
  });

  await run("upload base64 binary + download + verify", async () => {
    const testDir = `/openclaw-test-${Date.now()}`;
    const testFile = `${testDir}/binary.bin`;

    // 256 bytes with all byte values 0x00–0xFF
    const original = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) original[i] = i;
    const b64 = original.toString("base64");

    await findTool(tools, "yad_disk_mkdir").execute("t", { path: testDir });
    await findTool(tools, "yad_disk_upload").execute("t", {
      path: testFile,
      content: b64,
      encoding: "base64",
      content_type: "application/octet-stream",
    });

    const r = await findTool(tools, "yad_disk_download").execute("t", { path: testFile });
    const raw = r.content[0].text;
    // Download returns binary as "[Binary file, N bytes, base64]:\n<base64>"
    const b64Match = raw.match(/base64\]:\n(.+)$/s);
    if (!b64Match) throw new Error("Expected base64 output from download");
    const downloaded = Buffer.from(b64Match[1], "base64");

    if (!downloaded.equals(original)) {
      throw new Error(
        `Binary mismatch: original=${original.length} bytes, downloaded=${downloaded.length} bytes`,
      );
    }
    console.log(`    base64: ${original.length} bytes uploaded and verified ✓`);

    await findTool(tools, "yad_disk_delete").execute("t", { path: testDir });
  });

  await run("upload local binary file + download + verify", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");

    const testDir = `/openclaw-test-${Date.now()}`;
    const testFile = `${testDir}/local.bin`;

    // Create a 1 MB temp binary file with pseudo-random pattern
    const tmpPath = path.join(os.tmpdir(), `yad-smoke-${Date.now()}.bin`);
    const original = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < original.length; i++) original[i] = (i * 7 + 13) % 256;
    fs.writeFileSync(tmpPath, original);

    try {
      await findTool(tools, "yad_disk_mkdir").execute("t", { path: testDir });
      await findTool(tools, "yad_disk_upload").execute("t", {
        path: testFile,
        source_path: tmpPath,
      });

      const r = await findTool(tools, "yad_disk_download").execute("t", { path: testFile });
      const raw = r.content[0].text;
      const b64Match = raw.match(/base64\]:\n(.+)$/s);
      if (!b64Match) throw new Error("Expected binary output from download");
      const downloaded = Buffer.from(b64Match[1], "base64");

      if (!downloaded.equals(original)) {
        throw new Error(
          `Binary mismatch: original=${original.length} bytes, downloaded=${downloaded.length} bytes`,
        );
      }
      console.log(
        `    source_path: "${tmpPath}" → ${original.length} bytes uploaded and verified ✓`,
      );

      await findTool(tools, "yad_disk_delete").execute("t", { path: testDir });
    } finally {
      fs.unlinkSync(tmpPath);
    }
  });

  await run("download with target_path (stream to local file)", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");

    const testDir = `/openclaw-test-${Date.now()}`;
    const testFile = `${testDir}/streamed.bin`;
    const original = Buffer.alloc(512 * 1024);
    for (let i = 0; i < original.length; i++) original[i] = (i * 31) & 0xff;

    await findTool(tools, "yad_disk_mkdir").execute("t", { path: testDir });
    await findTool(tools, "yad_disk_upload").execute("t", {
      path: testFile,
      content: original.toString("base64"),
      encoding: "base64",
      content_type: "application/octet-stream",
    });

    const localDir = path.join(os.tmpdir(), `openclaw-dl-${Date.now()}`, "nested");
    const localPath = path.join(localDir, "streamed.bin");

    try {
      // Streaming download; parent dir created automatically
      const r = await findTool(tools, "yad_disk_download").execute("t", {
        path: testFile,
        target_path: localPath,
      });
      const meta = JSON.parse(r.content[0].text);
      if (meta.bytes !== original.length) {
        throw new Error(`bytes mismatch: expected ${original.length}, got ${meta.bytes}`);
      }
      const onDisk = fs.readFileSync(localPath);
      if (!onDisk.equals(original)) throw new Error("Streamed content mismatch");
      console.log(`    target_path → ${meta.bytes} bytes on disk ✓`);

      // Overwrite guard
      let blocked = false;
      try {
        await findTool(tools, "yad_disk_download").execute("t", {
          path: testFile,
          target_path: localPath,
        });
      } catch (e) {
        blocked = /already exists/.test((e as Error).message);
      }
      if (!blocked) throw new Error("Expected overwrite guard to trigger");
      console.log("    overwrite guard ✓");

      // Explicit overwrite
      await findTool(tools, "yad_disk_download").execute("t", {
        path: testFile,
        target_path: localPath,
        overwrite: true,
      });
      console.log("    overwrite=true ✓");
    } finally {
      if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
      fs.rmSync(path.dirname(path.dirname(localPath)), { recursive: true, force: true });
      await findTool(tools, "yad_disk_delete").execute("t", { path: testDir });
    }
  });

  // ---------------------------------------------------------------------------
  // REST API (OAuth) — only runs if YANDEX_DISK_OAUTH_TOKEN is set.
  // Tests routing of files > 10 MB through the REST CDN instead of WebDAV.
  // ---------------------------------------------------------------------------
  if (config.disk_oauth_token) {
    await run("REST upload/download round-trip (12 MB via source_path, sha256)", async () => {
      const fs = await import("node:fs");
      const os = await import("node:os");
      const path = await import("node:path");
      const crypto = await import("node:crypto");

      const testDir = `/openclaw-test-rest-${Date.now()}`;
      const remoteFile = `${testDir}/big.bin`;
      const size = 12 * 1024 * 1024; // Above WEBDAV_UPLOAD_LIMIT_BYTES → must use REST.

      const tmpDir = path.join(os.tmpdir(), `openclaw-rest-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      const srcPath = path.join(tmpDir, "big.bin");
      const dstPath = path.join(tmpDir, "big-downloaded.bin");

      try {
        // Generate deterministic payload and compute sha256.
        const buf = Buffer.alloc(size);
        for (let i = 0; i < size; i += 4) buf.writeUInt32LE((i * 2654435761) >>> 0, i);
        fs.writeFileSync(srcPath, buf);
        const srcHash = crypto.createHash("sha256").update(buf).digest("hex");

        await findTool(tools, "yad_disk_mkdir").execute("t", { path: testDir });

        const uploadResult = await findTool(tools, "yad_disk_upload").execute("t", {
          path: remoteFile,
          source_path: srcPath,
        });
        const uploadText = uploadResult.content[0].text;
        if (!uploadText.includes("transport: rest")) {
          throw new Error(`Expected REST transport, got: ${uploadText}`);
        }
        console.log(`    upload: ${uploadText.trim()}`);

        const dlResult = await findTool(tools, "yad_disk_download").execute("t", {
          path: remoteFile,
          target_path: dstPath,
        });
        const meta = JSON.parse(dlResult.content[0].text);
        if (meta.transport !== "rest") {
          throw new Error(`Expected REST download transport, got: ${meta.transport}`);
        }
        if (meta.bytes !== size) {
          throw new Error(`bytes mismatch: expected ${size}, got ${meta.bytes}`);
        }

        const dstHash = crypto.createHash("sha256").update(fs.readFileSync(dstPath)).digest("hex");
        if (srcHash !== dstHash) {
          throw new Error(`sha256 mismatch: src=${srcHash} dst=${dstHash}`);
        }
        console.log(`    round-trip: ${size} bytes, sha256 match ✓`);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        try {
          await findTool(tools, "yad_disk_delete").execute("t", { path: testDir });
        } catch {}
      }
    });
  } else {
    console.log("    REST API tests пропущены (YANDEX_DISK_OAUTH_TOKEN не задан)");
  }
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
    const listR = await findTool(tools, "yad_mail_list").execute("t", {
      folder: "INBOX",
      limit: 20,
    });
    const listData = JSON.parse(listR.content[0].text);

    let attachment: { index: number; filename: string; contentType: string; size: number } | null =
      null;
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

    console.log(
      `    Письмо UID ${msgUid}, вложение: ${attachment.filename} (${attachment.contentType}, ${attachment.size} bytes)`,
    );

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
    console.log(`    По filename: encoding=${data.encoding}, length=${data.content.length}`);

    // Тот же attachment по index
    const r2 = await findTool(tools, "yad_mail_get_attachment").execute("t", {
      uid: msgUid,
      filename: attachment.filename,
      index: attachment.index,
    });
    const data2 = JSON.parse(r2.content[0].text);

    if (data2.content !== data.content) {
      throw new Error("Content mismatch between filename and index lookups");
    }
    console.log(`    По index=${attachment.index}: совпадает ✓`);
  });

  await run("search recent", async () => {
    const since = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
    const r = await findTool(tools, "yad_mail_search").execute("t", { since, limit: 3 });
    const data = JSON.parse(r.content[0].text);
    console.log(`    Найдено за неделю: ${data.totalMatches}`);
  });

  await run("IDLE watcher (self-send → detect → cleanup)", async () => {
    const { startIdleWatcher } = await import("../src/mail/idle-watcher.js");
    const { resolveLogin } = await import("../src/common/types.js");
    const marker = `smoke-idle-${Date.now()}`;
    const selfAddress = resolveLogin(config.login);

    // Start IDLE watcher with a promise that resolves on new mail
    let resolveEnvelope: (v: import("../src/mail/idle-watcher.js").MailEnvelope) => void;
    const envelopePromise = new Promise<import("../src/mail/idle-watcher.js").MailEnvelope>(
      (resolve) => {
        resolveEnvelope = resolve;
      },
    );

    const logger = {
      debug: () => {},
      info: (msg: string) => console.log(`    [IDLE] ${msg}`),
      warn: (msg: string) => console.log(`    [IDLE] ⚠ ${msg}`),
      error: (msg: string) => console.log(`    [IDLE] ✗ ${msg}`),
    };

    const watcher = startIdleWatcher({
      config,
      logger,
      folder: "INBOX",
      notifyAgent: async (envelope) => {
        if (envelope.subject === marker) {
          resolveEnvelope(envelope);
        }
      },
    });

    // Give IDLE time to establish connection and enter IDLE mode
    await new Promise((resolve) => setTimeout(resolve, 3000));
    console.log("    IDLE подключён, отправляю письмо...");

    // Send email to self
    await findTool(tools, "yad_mail_send").execute("t", {
      to: selfAddress,
      subject: marker,
      text: "IDLE smoke test — safe to delete",
    });
    console.log(
      `    Письмо отправлено, жду обнаружения (таймаут 60с)... ${new Date().toLocaleTimeString()}`,
    );

    // Wait for IDLE to detect the new message (timeout 60s)
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("IDLE не обнаружил письмо за 60 секунд")), 60_000),
    );
    const envelope = await Promise.race([envelopePromise, timeout]);

    console.log(`    Обнаружено: UID=${envelope.uid}, subject="${envelope.subject}"`);
    if (envelope.subject !== marker) throw new Error("Subject mismatch");
    if (!envelope.from.includes(selfAddress)) throw new Error("From mismatch");

    // Stop IDLE watcher
    await watcher.stop();
    console.log("    IDLE watcher остановлен");

    // Cleanup: delete the test email via yad_mail_delete
    await findTool(tools, "yad_mail_delete").execute("t", { uids: [envelope.uid] });
    console.log(`    Тестовое письмо UID=${envelope.uid} удалено`);
  });
  await run("delete + mark (send → mark unread → mark read → delete)", async () => {
    const { resolveLogin } = await import("../src/common/types.js");
    const selfAddress = resolveLogin(config.login);
    const marker = `smoke-delete-mark-${Date.now()}`;

    // Send a test email
    await findTool(tools, "yad_mail_send").execute("t", {
      to: selfAddress,
      subject: marker,
      text: "Test for delete + mark tools",
    });
    console.log("    Письмо отправлено");

    // Wait for delivery, find via list (search has fetch issues with fresh UIDs)
    let uid: number | undefined;
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const listR = await findTool(tools, "yad_mail_list").execute("t", {
        folder: "INBOX",
        limit: 10,
      });
      const listData = JSON.parse(listR.content[0].text);
      const found = listData.messages.find(
        (m: { subject: string; uid: number }) => m.subject === marker,
      );
      if (found) {
        uid = found.uid;
        break;
      }
    }
    if (!uid) throw new Error("Test email not delivered after 30s");
    console.log(`    Найдено: UID=${uid}`);

    // Mark as unread
    const markUnread = await findTool(tools, "yad_mail_mark").execute("t", {
      uids: [uid],
      seen: false,
    });
    const unreadData = JSON.parse(markUnread.content[0].text);
    if (unreadData.updated.length === 0) throw new Error("Mark unread failed");
    console.log("    Mark unread ✓");

    // Mark as read
    const markRead = await findTool(tools, "yad_mail_mark").execute("t", {
      uids: [uid],
      seen: true,
    });
    const readData = JSON.parse(markRead.content[0].text);
    if (readData.updated.length === 0) throw new Error("Mark read failed");
    console.log("    Mark read ✓");

    // Delete
    const delR = await findTool(tools, "yad_mail_delete").execute("t", { uids: [uid] });
    const delData = JSON.parse(delR.content[0].text);
    if (delData.deleted.length === 0) throw new Error("Delete failed");
    console.log(`    Delete UID=${uid} ✓`);
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
process.exit(0);
