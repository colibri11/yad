import { Type } from "@sinclair/typebox";
import { createDAVClient, type DAVCalendar } from "tsdav";
import { dtLine, formatDT, parseVEvent } from "../common/ical.js";
import type { YandexPluginConfig } from "../common/types.js";
import { jsonResult, requirePassword, resolveLogin, textResult } from "../common/types.js";

const CALDAV_BASE = "https://caldav.yandex.ru";
const TIMEOUT_MS = 30_000;

interface CalDavAuth {
  login: string;
  password: string;
}

function calAuth(config: YandexPluginConfig): CalDavAuth {
  return {
    login: resolveLogin(config.login),
    password: requirePassword(config, "calendar"),
  };
}

function authHeader(auth: CalDavAuth): string {
  return `Basic ${Buffer.from(`${auth.login}:${auth.password}`).toString("base64")}`;
}

async function createCalDavClient(config: YandexPluginConfig) {
  const auth = calAuth(config);
  return createDAVClient({
    serverUrl: CALDAV_BASE,
    credentials: { username: auth.login, password: auth.password },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });
}

/** PUT iCal directly to CalDAV — bypasses tsdav to avoid iCal mangling */
async function putCalendarObject(
  auth: CalDavAuth,
  calendarUrl: string,
  filename: string,
  ical: string,
): Promise<void> {
  const url = `${calendarUrl}${filename}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authHeader(auth),
      "Content-Type": "text/calendar; charset=utf-8",
      "If-None-Match": "*",
    },
    body: ical,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok && res.status !== 201) {
    throw new Error(`CalDAV PUT ${filename} failed: ${res.status} ${res.statusText}`);
  }
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

        const start = params.start;
        const end =
          params.end ?? (start ? new Date(Date.now() + 30 * 86400000).toISOString() : undefined);
        const timeRange = start && end ? { start, end } : undefined;

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
        const a = calAuth(config);
        let calendarUrl: string;

        if (params.calendar_url) {
          calendarUrl = params.calendar_url;
        } else {
          const client = await createCalDavClient(config);
          const calendars = await client.fetchCalendars();
          if (calendars.length === 0) throw new Error("No calendars found");
          calendarUrl = calendars[0].url;
        }

        const uid = crypto.randomUUID();
        const dtstamp = formatDT(new Date().toISOString());

        const ical =
          [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Yad OpenClaw Plugin//EN",
            "BEGIN:VEVENT",
            `DTSTAMP:${dtstamp}`,
            `UID:${uid}`,
            dtLine("DTSTART", params.start),
            dtLine("DTEND", params.end),
            `SUMMARY:${params.summary}`,
            params.description ? `DESCRIPTION:${params.description}` : "",
            params.location ? `LOCATION:${params.location}` : "",
            "SEQUENCE:0",
            "END:VEVENT",
            "END:VCALENDAR",
          ]
            .filter(Boolean)
            .join("\r\n") + "\r\n";

        await putCalendarObject(a, calendarUrl, `${uid}.ics`, ical);

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
        const a = calAuth(config);
        const client = await createCalDavClient(config);

        // Fetch current event
        const lastSlash = params.event_url.lastIndexOf("/");
        const calUrl =
          lastSlash >= 0 ? params.event_url.substring(0, lastSlash + 1) : params.event_url;
        const objects = await client.fetchCalendarObjects({
          calendar: { url: calUrl } as DAVCalendar,
        });
        const existing = objects.find((o) => o.url === params.event_url);
        if (!existing?.data) throw new Error(`Event not found at ${params.event_url}`);

        const current = parseVEvent(existing.data);
        const uid = current.uid || crypto.randomUUID();
        const dtstamp = formatDT(new Date().toISOString());

        const ical =
          [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Yad OpenClaw Plugin//EN",
            "BEGIN:VEVENT",
            `DTSTAMP:${dtstamp}`,
            `UID:${uid}`,
            dtLine("DTSTART", params.start || current.dtstart || new Date().toISOString()),
            dtLine("DTEND", params.end || current.dtend || new Date().toISOString()),
            `SUMMARY:${params.summary ?? current.summary}`,
            (params.description ?? current.description)
              ? `DESCRIPTION:${params.description ?? current.description}`
              : "",
            (params.location ?? current.location)
              ? `LOCATION:${params.location ?? current.location}`
              : "",
            "SEQUENCE:1",
            "END:VEVENT",
            "END:VCALENDAR",
          ]
            .filter(Boolean)
            .join("\r\n") + "\r\n";

        // Direct PUT — bypass tsdav to avoid iCal mangling
        const eventUrl = params.event_url.startsWith("http")
          ? params.event_url
          : `${CALDAV_BASE}${params.event_url}`;
        const res = await fetch(eventUrl, {
          method: "PUT",
          headers: {
            Authorization: authHeader(a),
            "Content-Type": "text/calendar; charset=utf-8",
            ...(existing.etag ? { "If-Match": existing.etag } : {}),
          },
          body: ical,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
          throw new Error(`CalDAV PUT update failed: ${res.status} ${res.statusText}`);
        }

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
        const a = calAuth(config);
        const url = params.event_url.startsWith("http")
          ? params.event_url
          : `${CALDAV_BASE}${params.event_url}`;
        const res = await fetch(url, {
          method: "DELETE",
          headers: { Authorization: authHeader(a) },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
          throw new Error(`CalDAV DELETE failed: ${res.status} ${res.statusText}`);
        }
        return textResult(`Event deleted: ${params.event_url}`);
      },
    },
  ];
}
