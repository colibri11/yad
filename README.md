# @openclaw/yandex

Плагин для [OpenClaw](https://github.com/openclaw/openclaw), подключающий сервисы Яндекса: Почту, Календарь, Диск и Контакты.

Все сервисы работают через **пароли приложений** — не нужно создавать OAuth-приложение. Пароли создаются на одной странице: [id.yandex.ru/security/app-passwords](https://id.yandex.ru/security/app-passwords).

## Подключаемые сервисы

| Сервис | Протокол | Тип пароля приложения | Инструментов |
|--------|----------|-----------------------|:------------:|
| Яндекс.Диск | WebDAV | Файлы | 9 |
| Яндекс.Почта | IMAP / SMTP | Почта | 4 |
| Яндекс.Календарь | CalDAV | Календари | 5 |
| Яндекс.Контакты | CardDAV | Контакты | 5 |

## Установка

```bash
openclaw plugins install @openclaw/yandex
```

Для локальной разработки:

```bash
git clone <repo-url>
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
| `yandex_disk_list` | Список файлов и папок |
| `yandex_disk_info` | Свойства файла или папки |
| `yandex_disk_download` | Скачать файл (текст или base64) |
| `yandex_disk_upload` | Загрузить текстовый файл |
| `yandex_disk_mkdir` | Создать папку |
| `yandex_disk_delete` | Удалить файл или папку |
| `yandex_disk_move` | Переместить / переименовать |
| `yandex_disk_copy` | Копировать |
| `yandex_disk_publish` | Опубликовать / снять публикацию |

### Яндекс.Почта (IMAP/SMTP)

| Инструмент | Описание |
|------------|----------|
| `yandex_mail_list` | Список писем в папке |
| `yandex_mail_read` | Прочитать письмо целиком |
| `yandex_mail_send` | Отправить письмо |
| `yandex_mail_search` | Поиск писем по отправителю, теме, дате |

### Яндекс.Календарь (CalDAV)

| Инструмент | Описание |
|------------|----------|
| `yandex_calendar_list` | Список календарей |
| `yandex_calendar_events` | Список событий (с фильтрацией по датам) |
| `yandex_calendar_create_event` | Создать событие |
| `yandex_calendar_update_event` | Изменить событие |
| `yandex_calendar_delete_event` | Удалить событие |

### Яндекс.Контакты (CardDAV)

| Инструмент | Описание |
|------------|----------|
| `yandex_contacts_list` | Список контактов |
| `yandex_contacts_get` | Получить контакт |
| `yandex_contacts_create` | Создать контакт |
| `yandex_contacts_update` | Изменить контакт |
| `yandex_contacts_delete` | Удалить контакт |

## Разработка

```bash
npm install               # Установить зависимости
npx tsc --noEmit          # Проверка типов
npx tsc                   # Сборка в dist/
openclaw plugins install -l .  # Установить локально в OpenClaw
```

## Лицензия

[MIT](LICENSE)
