import { beforeEach, describe, expect, it, vi } from "vitest";
import type { YandexPluginConfig } from "../../common/types.js";

const {
  mockFetchCalendars,
  mockFetchCalendarObjects,
  mockCreateCalendarObject,
  mockUpdateCalendarObject,
  mockDeleteCalendarObject,
} = vi.hoisted(() => ({
  mockFetchCalendars: vi.fn(),
  mockFetchCalendarObjects: vi.fn(),
  mockCreateCalendarObject: vi.fn(),
  mockUpdateCalendarObject: vi.fn(),
  mockDeleteCalendarObject: vi.fn(),
}));

vi.mock("tsdav", () => ({
  createDAVClient: vi.fn().mockResolvedValue({
    fetchCalendars: mockFetchCalendars,
    fetchCalendarObjects: mockFetchCalendarObjects,
    createCalendarObject: mockCreateCalendarObject,
    updateCalendarObject: mockUpdateCalendarObject,
    deleteCalendarObject: mockDeleteCalendarObject,
  }),
}));

import { createCalendarTools } from "../calendar-tools.js";

const config: YandexPluginConfig = {
  login: "user",
  calendar_app_password: "cal-secret",
};

function findTool(name: string) {
  const tools = createCalendarTools(config);
  return tools.find((t) => t.name === name)!;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("yad_calendar_list", () => {
  it("returns all calendars", async () => {
    mockFetchCalendars.mockResolvedValue([
      { displayName: "Personal", url: "/cal/1/", ctag: "abc", description: "My calendar" },
      { displayName: "Work", url: "/cal/2/", ctag: "def", description: "" },
    ]);

    const tool = findTool("yad_calendar_list");
    const result = await tool.execute();
    const data = JSON.parse(result.content[0].text);

    expect(data).toHaveLength(2);
    expect(data[0].displayName).toBe("Personal");
    expect(data[1].displayName).toBe("Work");
  });
});

describe("yad_calendar_events", () => {
  it("fetches events from first calendar when no URL given", async () => {
    mockFetchCalendars.mockResolvedValue([{ displayName: "Personal", url: "/cal/1/" }]);
    mockFetchCalendarObjects.mockResolvedValue([
      {
        data: `BEGIN:VEVENT\nSUMMARY:Meeting\nDTSTART:20260410T140000Z\nDTEND:20260410T150000Z\nUID:evt-1\nEND:VEVENT`,
        url: "/cal/1/evt-1.ics",
        etag: "etag1",
      },
    ]);

    const tool = findTool("yad_calendar_events");
    const result = await tool.execute("id", {});
    const events = JSON.parse(result.content[0].text);

    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Meeting");
    expect(events[0].uid).toBe("evt-1");
  });

  it("uses provided calendar URL", async () => {
    mockFetchCalendarObjects.mockResolvedValue([]);

    const tool = findTool("yad_calendar_events");
    await tool.execute("id", { calendar_url: "/cal/custom/" });

    expect(mockFetchCalendarObjects).toHaveBeenCalledWith(
      expect.objectContaining({
        calendar: { url: "/cal/custom/" },
      }),
    );
  });

  it("passes time range when both start and end given", async () => {
    mockFetchCalendarObjects.mockResolvedValue([]);

    const tool = findTool("yad_calendar_events");
    await tool.execute("id", {
      calendar_url: "/cal/1/",
      start: "2026-04-01T00:00:00Z",
      end: "2026-04-30T23:59:59Z",
    });

    expect(mockFetchCalendarObjects).toHaveBeenCalledWith(
      expect.objectContaining({
        timeRange: { start: "2026-04-01T00:00:00Z", end: "2026-04-30T23:59:59Z" },
      }),
    );
  });

  it("throws when no calendars found", async () => {
    mockFetchCalendars.mockResolvedValue([]);

    const tool = findTool("yad_calendar_events");
    await expect(tool.execute("id", {})).rejects.toThrow("No calendars found");
  });
});

describe("yad_calendar_create_event", () => {
  it("creates event via direct PUT with correct iCal", async () => {
    mockFetchCalendars.mockResolvedValue([{ url: "https://caldav.yandex.ru/cal/1/" }]);
    // Mock global fetch for direct PUT
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal("fetch", mockFetch);

    const tool = findTool("yad_calendar_create_event");
    const result = await tool.execute("id", {
      summary: "Lunch",
      start: "2026-04-10T12:00:00",
      end: "2026-04-10T13:00:00",
      location: "Cafe",
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toMatch(/^https:\/\/caldav\.yandex\.ru\/cal\/1\/.*\.ics$/);
    expect(opts.method).toBe("PUT");
    expect(opts.headers["Content-Type"]).toBe("text/calendar; charset=utf-8");

    const body = opts.body as string;
    expect(body).toContain("SUMMARY:Lunch");
    expect(body).toContain("LOCATION:Cafe");
    expect(body).toContain("DTSTART;VALUE=DATE-TIME:20260410T120000Z");
    expect(body).toContain("DTEND;VALUE=DATE-TIME:20260410T130000Z");
    expect(body).toContain("DTSTAMP:");
    expect(body).toContain("SEQUENCE:0");
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("END:VCALENDAR");

    expect(result.content[0].text).toContain("Lunch");

    vi.unstubAllGlobals();
  });
});

describe("yad_calendar_update_event", () => {
  it("fetches existing event and updates via direct PUT", async () => {
    mockFetchCalendarObjects.mockResolvedValue([
      {
        data: `BEGIN:VEVENT\nSUMMARY:Old title\nDTSTART:20260410T140000Z\nDTEND:20260410T150000Z\nUID:evt-1\nEND:VEVENT`,
        url: "/cal/1/evt-1.ics",
        etag: '"etag1"',
      },
    ]);
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const tool = findTool("yad_calendar_update_event");
    const result = await tool.execute("id", {
      event_url: "/cal/1/evt-1.ics",
      summary: "New title",
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = mockFetch.mock.calls[0][1].body as string;
    expect(body).toContain("SUMMARY:New title");
    expect(body).toContain("UID:evt-1");
    expect(result.content[0].text).toContain("New title");

    vi.unstubAllGlobals();
  });

  it("throws when event not found", async () => {
    mockFetchCalendarObjects.mockResolvedValue([]);

    const tool = findTool("yad_calendar_update_event");
    await expect(
      tool.execute("id", { event_url: "/cal/1/missing.ics", summary: "X" }),
    ).rejects.toThrow("Event not found");
  });
});

describe("yad_calendar_delete_event", () => {
  it("deletes event via direct DELETE", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const tool = findTool("yad_calendar_delete_event");
    await tool.execute("id", { event_url: "/cal/1/evt-1.ics" });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://caldav.yandex.ru/cal/1/evt-1.ics");
    expect(opts.method).toBe("DELETE");

    vi.unstubAllGlobals();
  });
});
