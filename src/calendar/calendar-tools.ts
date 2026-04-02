import { Type } from "@sinclair/typebox";
import { createDAVClient, type DAVCalendar } from "tsdav";
import { formatDT, parseVEvent } from "../common/ical.js";
import type { YandexPluginConfig } from "../common/types.js";
import { jsonResult, requirePassword, resolveLogin, textResult } from "../common/types.js";

async function createCalDavClient(config: YandexPluginConfig) {
  return createDAVClient({
    serverUrl: "https://caldav.yandex.ru",
    credentials: {
      username: resolveLogin(config.login),
      password: requirePassword(config, "calendar"),
    },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });
}

export function createCalendarTools(config: YandexPluginConfig) {
  return [
    {
      name: "yad_calendar_list",
      description: "List all calendars in the user's Yandex.Calendar account.",
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute() {
        const client = await createCalDavClient(config);
        const calendars = await client.fetchCalendars();
        return jsonResult(
          calendars.map((c) => ({
            displayName: c.displayName,
            url: c.url,
            ctag: c.ctag,
            description: c.description,
          })),
        );
      },
    },
    {
      name: "yad_calendar_events",
      description:
        "List events from a Yandex Calendar within an optional date range. " +
        "If no calendar URL is given, events from the default calendar are returned.",
      parameters: Type.Object(
        {
          calendar_url: Type.Optional(
            Type.String({
              description:
                "Calendar URL from yad_calendar_list. If omitted, uses the first calendar.",
            }),
          ),
          start: Type.Optional(
            Type.String({ description: "Start date/time (ISO 8601), e.g. 2026-04-01T00:00:00Z" }),
          ),
          end: Type.Optional(
            Type.String({ description: "End date/time (ISO 8601), e.g. 2026-04-30T23:59:59Z" }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { calendar_url?: string; start?: string; end?: string }) {
        const client = await createCalDavClient(config);
        let calendar: DAVCalendar;

        if (params.calendar_url) {
          calendar = { url: params.calendar_url } as DAVCalendar;
        } else {
          const calendars = await client.fetchCalendars();
          if (calendars.length === 0) throw new Error("No calendars found");
          calendar = calendars[0];
        }

        const timeRange =
          params.start && params.end ? { start: params.start, end: params.end } : undefined;

        const objects = await client.fetchCalendarObjects({
          calendar,
          ...(timeRange && { timeRange }),
        });

        const events = objects
          .filter((o) => o.data)
          .map((o) => ({
            ...parseVEvent(o.data!),
            url: o.url,
            etag: o.etag,
          }));

        return jsonResult(events);
      },
    },
    {
      name: "yad_calendar_create_event",
      description:
        "Create a new event in Yandex Calendar. " + "Specify at least a title and start time.",
      parameters: Type.Object(
        {
          summary: Type.String({ description: "Event title" }),
          start: Type.String({
            description: "Start date/time in ISO 8601 (e.g. 2026-04-10T14:00:00)",
          }),
          end: Type.String({ description: "End date/time in ISO 8601 (e.g. 2026-04-10T15:00:00)" }),
          description: Type.Optional(Type.String({ description: "Event description" })),
          location: Type.Optional(Type.String({ description: "Event location" })),
          calendar_url: Type.Optional(
            Type.String({ description: "Calendar URL. If omitted, uses the first calendar." }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(
        _id: string,
        params: {
          summary: string;
          start: string;
          end: string;
          description?: string;
          location?: string;
          calendar_url?: string;
        },
      ) {
        const client = await createCalDavClient(config);
        let calendar: DAVCalendar;

        if (params.calendar_url) {
          calendar = { url: params.calendar_url } as DAVCalendar;
        } else {
          const calendars = await client.fetchCalendars();
          if (calendars.length === 0) throw new Error("No calendars found");
          calendar = calendars[0];
        }

        const uid = crypto.randomUUID();
        const dtstart = formatDT(params.start);
        const dtend = formatDT(params.end);

        const ical = [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//OpenClaw Yandex Plugin//EN",
          "BEGIN:VEVENT",
          `UID:${uid}`,
          `DTSTART:${dtstart}`,
          `DTEND:${dtend}`,
          `SUMMARY:${params.summary}`,
          params.description ? `DESCRIPTION:${params.description}` : "",
          params.location ? `LOCATION:${params.location}` : "",
          `DTSTAMP:${formatDT(new Date().toISOString())}`,
          "END:VEVENT",
          "END:VCALENDAR",
        ]
          .filter(Boolean)
          .join("\r\n");

        await client.createCalendarObject({
          calendar,
          filename: `${uid}.ics`,
          iCalString: ical,
        });

        return textResult(`Event created: "${params.summary}" (${params.start} — ${params.end})`);
      },
    },
    {
      name: "yad_calendar_update_event",
      description:
        "Update an existing event in Yandex Calendar. " +
        "Requires the event URL (from yad_calendar_events) and the fields to update.",
      parameters: Type.Object(
        {
          event_url: Type.String({ description: "Event URL from yad_calendar_events" }),
          summary: Type.Optional(Type.String({ description: "New title" })),
          start: Type.Optional(Type.String({ description: "New start date/time (ISO 8601)" })),
          end: Type.Optional(Type.String({ description: "New end date/time (ISO 8601)" })),
          description: Type.Optional(Type.String({ description: "New description" })),
          location: Type.Optional(Type.String({ description: "New location" })),
        },
        { additionalProperties: false },
      ),
      async execute(
        _id: string,
        params: {
          event_url: string;
          summary?: string;
          start?: string;
          end?: string;
          description?: string;
          location?: string;
        },
      ) {
        const client = await createCalDavClient(config);

        // Fetch current event
        const calUrl = params.event_url.replace(/[^/]+\.ics$/, "");
        const objects = await client.fetchCalendarObjects({
          calendar: { url: calUrl } as DAVCalendar,
        });
        const existing = objects.find((o) => o.url === params.event_url);
        if (!existing?.data) throw new Error(`Event not found at ${params.event_url}`);

        const current = parseVEvent(existing.data);
        const uid = current.uid || crypto.randomUUID();
        const dtstart = formatDT(params.start || current.dtstart || new Date().toISOString());
        const dtend = formatDT(params.end || current.dtend || new Date().toISOString());

        const ical = [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//OpenClaw Yandex Plugin//EN",
          "BEGIN:VEVENT",
          `UID:${uid}`,
          `DTSTART:${dtstart}`,
          `DTEND:${dtend}`,
          `SUMMARY:${params.summary ?? current.summary}`,
          (params.description ?? current.description)
            ? `DESCRIPTION:${params.description ?? current.description}`
            : "",
          (params.location ?? current.location)
            ? `LOCATION:${params.location ?? current.location}`
            : "",
          `DTSTAMP:${formatDT(new Date().toISOString())}`,
          "END:VEVENT",
          "END:VCALENDAR",
        ]
          .filter(Boolean)
          .join("\r\n");

        await client.updateCalendarObject({
          calendarObject: {
            url: params.event_url,
            data: ical,
            etag: existing.etag,
          },
        });

        return textResult(`Event updated: "${params.summary ?? current.summary}"`);
      },
    },
    {
      name: "yad_calendar_delete_event",
      description: "Delete an event from Yandex Calendar by its URL.",
      parameters: Type.Object(
        {
          event_url: Type.String({ description: "Event URL from yad_calendar_events" }),
        },
        { additionalProperties: false },
      ),
      async execute(_id: string, params: { event_url: string }) {
        const client = await createCalDavClient(config);
        await client.deleteCalendarObject({
          calendarObject: { url: params.event_url, etag: "" },
        });
        return textResult(`Event deleted: ${params.event_url}`);
      },
    },
  ];
}
