# Yad

Плагин для [OpenClaw](https://github.com/openclaw/openclaw), подключающий сервисы Яндекса: Почту, Календарь, Диск и Контакты.

Все сервисы работают через **пароли приложений** — не нужно создавать OAuth-приложение. Пароли создаются на одной странице: [id.yandex.ru/security/app-passwords](https://id.yandex.ru/security/app-passwords).

## Подключаемые сервисы

| Сервис | Протокол | Тип пароля приложения | Инструментов |
|--------|----------|-----------------------|:------------:|
| Яндекс.Диск | WebDAV | Файлы | 9 |
| Яндекс.Почта | IMAP / SMTP | Почта | 5 |
| Яндекс.Календарь | CalDAV | Календари | 5 |
| Яндекс.Контакты | CardDAV | Контакты | 5 |

## Установка

```bash
git clone https://github.com/colibri11/yad.git
cd yad
npm install
openclaw plugins install -l .
```

## Настройка

В конфигурации OpenClaw укажите логин и пароли приложений для нужных сервисов:

```json
{
  "login": "user@yandex.ru",
  "disk_app_password": "xxxx-xxxx-xxxx-xxxx",
  "mail_app_password": "xxxx-xxxx-xxxx-xxxx",
  "calendar_app_password": "xxxx-xxxx-xxxx-xxxx",
  "contacts_app_password": "xxxx-xxxx-xxxx-xxxx"
}
```

Обязателен только `login`. Каждый сервис подключается независимо — укажите пароль только для тех сервисов, которые хотите использовать.

### IMAP IDLE — мониторинг входящей почты в реальном времени

Плагин поддерживает фоновый мониторинг почтового ящика через IMAP IDLE (RFC 2177). При поступлении нового письма автоматически запускается обработка указанным агентом.

Для включения добавьте в конфигурацию плагина:

```json
{
  "mail_idle_agent_id": "mail-processor",
  "mail_idle_folder": "INBOX"
}
```

- `mail_idle_agent_id` — ID агента OpenClaw, который будет обрабатывать входящие письма. Наличие этого поля включает IDLE. Без него — IDLE не запускается.
- `mail_idle_folder` — папка для мониторинга (по умолчанию `INBOX`).

Требуется настроенный `mail_app_password` и отдельный агент в конфигурации OpenClaw:

```json5
{
  agents: {
    list: [
      { id: "main", default: true, workspace: "..." },
      { id: "mail-processor", workspace: "..." }
    ]
  }
}
```

Агент `mail-processor` получает сообщение с envelope письма (отправитель, тема, UID) и использует инструменты `yad_mail_read` и `yad_mail_get_attachment` для чтения и обработки вложений.

### Как создать пароли приложений

1. Откройте [id.yandex.ru/security/app-passwords](https://id.yandex.ru/security/app-passwords)
2. Создайте пароль для каждого нужного сервиса, выбрав соответствующий тип:
   - **Файлы** — для Яндекс.Диска
   - **Почта** — для Яндекс.Почты
   - **Календари** — для Яндекс.Календаря
   - **Контакты** — для Яндекс.Контактов
3. Скопируйте каждый пароль в конфигурацию плагина

## Инструменты

### Яндекс.Диск (WebDAV)

| Инструмент | Описание |
|------------|----------|
| `yad_disk_list` | Список файлов и папок |
| `yad_disk_info` | Свойства файла или папки |
| `yad_disk_download` | Скачать файл (текст или base64) |
| `yad_disk_upload` | Загрузить текстовый файл |
| `yad_disk_mkdir` | Создать папку |
| `yad_disk_delete` | Удалить файл или папку |
| `yad_disk_move` | Переместить / переименовать |
| `yad_disk_copy` | Копировать |
| `yad_disk_publish` | Опубликовать / снять публикацию |

### Яндекс.Почта (IMAP/SMTP)

| Инструмент | Описание |
|------------|----------|
| `yad_mail_list` | Список писем в папке |
| `yad_mail_read` | Прочитать письмо целиком |
| `yad_mail_send` | Отправить письмо |
| `yad_mail_get_attachment` | Скачать вложение из письма |
| `yad_mail_search` | Поиск писем по отправителю, теме, дате |

### Яндекс.Календарь (CalDAV)

| Инструмент | Описание |
|------------|----------|
| `yad_calendar_list` | Список календарей |
| `yad_calendar_events` | Список событий (с фильтрацией по датам) |
| `yad_calendar_create_event` | Создать событие |
| `yad_calendar_update_event` | Изменить событие |
| `yad_calendar_delete_event` | Удалить событие |

### Яндекс.Контакты (CardDAV)

| Инструмент | Описание |
|------------|----------|
| `yad_contacts_list` | Список контактов |
| `yad_contacts_get` | Получить контакт |
| `yad_contacts_create` | Создать контакт |
| `yad_contacts_update` | Изменить контакт |
| `yad_contacts_delete` | Удалить контакт |

## Разработка

```bash
npm install                    # Установить зависимости
npx tsc                        # Сборка в dist/
npx vitest run                 # Запуск тестов
npx biome check .              # Линтинг + форматирование
openclaw plugins install -l .  # Установить локально в OpenClaw
```

### Smoke-тест с реальными сервисами

```bash
export YANDEX_LOGIN="user@yandex.ru"
export YANDEX_DISK_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export YANDEX_MAIL_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export YANDEX_CALENDAR_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export YANDEX_CONTACTS_PASSWORD="xxxx-xxxx-xxxx-xxxx"
npx tsx scripts/smoke-test.ts
```

Можно задать только часть паролей — ненастроенные сервисы будут пропущены.

## Лицензия

[MIT](LICENSE)
