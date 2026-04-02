# Участие в разработке

## Быстрый старт

```bash
git clone https://github.com/colibri11/yad.git
cd yad
npm install
```

## Команды

```bash
npx tsc --noEmit             # Проверка типов
npx tsc                      # Сборка в dist/
npx vitest run               # Запуск тестов
npx vitest run src/common    # Тесты конкретного модуля
npx vitest run -t "parseVCard"  # Тест по имени
npx biome check .            # Линтинг + форматирование
npx biome check --write .    # Автоисправление
```

Перед отправкой PR убедитесь, что все три проверки проходят:

```bash
npx tsc && npx biome check . && npx vitest run
```

## Структура проекта

```
index.ts                  — точка входа плагина (definePluginEntry)
openclaw.plugin.json      — манифест OpenClaw (список tool-ов, конфигурация)
src/
  common/
    types.ts              — YandexPluginConfig, resolveLogin, textResult, jsonResult
    webdav.ts             — WebDAV-клиент для Диска (native fetch)
    carddav.ts            — CardDAV-клиент для Контактов (native fetch)
    ical.ts               — парсер iCalendar (parseVEvent, formatDT)
    vcard.ts              — парсер vCard (parseVCard)
  disk/                   — инструменты Яндекс.Диска (WebDAV)
  mail/                   — инструменты Яндекс.Почты (IMAP/SMTP)
  calendar/               — инструменты Яндекс.Календаря (CalDAV)
  contacts/               — инструменты Яндекс.Контактов (CardDAV)
```

Тесты лежат в `__tests__/` рядом с тестируемым модулем.

## Как добавить новый сервис

1. Создайте директорию `src/{сервис}/`
2. Реализуйте фабричную функцию `create*Tools(config: YandexPluginConfig)`, возвращающую массив tool-определений
3. Зарегистрируйте в `index.ts` с проверкой наличия пароля:
   ```typescript
   if (config.new_service_app_password) {
     registerTools(createNewServiceTools(config));
   }
   ```
4. Добавьте имена tool-ов в `openclaw.plugin.json` → `contracts.tools`
5. Добавьте поле пароля в `configSchema` и `uiHints` в том же файле
6. Добавьте поле в интерфейс `YandexPluginConfig` в `src/common/types.ts`
7. Напишите тесты в `src/{сервис}/__tests__/`

## Соглашения

- **Имена tool-ов:** `yad_{сервис}_{действие}` (snake_case)
- **Описания tool-ов и параметров:** на английском (требование OpenClaw SDK)
- **Параметры:** `Type.Object(...)` из `@sinclair/typebox` с `{ additionalProperties: false }`
- **Результаты:** через `textResult()` или `jsonResult()` из `src/common/types.ts`
- **Аутентификация:** Basic Auth (login + пароль приложения), создаётся внутри каждого tool-вызова
- **Общие парсеры** (iCal, vCard, XML) — в `src/common/`, не внутри модулей сервисов

## Тестирование

- **Чистые функции** (парсеры, хелперы) — unit-тесты без моков
- **WebDAV-клиент** — мок `fetch` через `vi.stubGlobal`
- **CardDAV-клиент** — мок `fetch` через `vi.stubGlobal` (аналогично WebDAV)
- **Tool execute()** — мок внешних библиотек (`tsdav`, `imapflow`, `nodemailer`, `carddav`) через `vi.mock` + `vi.hoisted`

## Линтинг

Проект использует [Biome](https://biomejs.dev/) для линтинга и форматирования. Конфигурация в `biome.json`. Biome заменяет ESLint + Prettier одним инструментом.

Расширения для IDE:
- VS Code: [Biome](https://marketplace.visualstudio.com/items?itemName=biomejs.biome)
- JetBrains: [Biome](https://plugins.jetbrains.com/plugin/22761-biome)
