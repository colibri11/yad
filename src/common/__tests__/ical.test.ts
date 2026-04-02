import { describe, expect, it } from "vitest";
import { dtLine, formatDT, parseVEvent, unfold } from "../ical.js";

describe("parseVEvent", () => {
  const sampleEvent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:abc-123-def
DTSTART:20260410T140000Z
DTEND:20260410T150000Z
SUMMARY:Team standup
LOCATION:Office Room 3
DESCRIPTION:Daily sync meeting
STATUS:CONFIRMED
RRULE:FREQ=DAILY;COUNT=5
DTSTAMP:20260401T100000Z
END:VEVENT
END:VCALENDAR`;

  it("extracts summary", () => {
    expect(parseVEvent(sampleEvent).summary).toBe("Team standup");
  });

  it("extracts dtstart and dtend", () => {
    const e = parseVEvent(sampleEvent);
    expect(e.dtstart).toBe("20260410T140000Z");
    expect(e.dtend).toBe("20260410T150000Z");
  });

  it("extracts location", () => {
    expect(parseVEvent(sampleEvent).location).toBe("Office Room 3");
  });

  it("extracts description", () => {
    expect(parseVEvent(sampleEvent).description).toBe("Daily sync meeting");
  });

  it("extracts uid", () => {
    expect(parseVEvent(sampleEvent).uid).toBe("abc-123-def");
  });

  it("extracts status", () => {
    expect(parseVEvent(sampleEvent).status).toBe("CONFIRMED");
  });

  it("extracts rrule", () => {
    expect(parseVEvent(sampleEvent).rrule).toBe("FREQ=DAILY;COUNT=5");
  });

  it("returns '(no title)' when SUMMARY is missing", () => {
    const minimal = `BEGIN:VEVENT
UID:test-1
DTSTART:20260410T140000Z
END:VEVENT`;
    expect(parseVEvent(minimal).summary).toBe("(no title)");
  });

  it("returns undefined for missing optional fields", () => {
    const minimal = `BEGIN:VEVENT
SUMMARY:Minimal
END:VEVENT`;
    const e = parseVEvent(minimal);
    expect(e.location).toBeUndefined();
    expect(e.description).toBeUndefined();
    expect(e.rrule).toBeUndefined();
  });

  it("handles DTSTART with VALUE=DATE parameter", () => {
    const allDay = `BEGIN:VEVENT
SUMMARY:Holiday
DTSTART;VALUE=DATE:20260501
DTEND;VALUE=DATE:20260502
END:VEVENT`;
    const e = parseVEvent(allDay);
    expect(e.dtstart).toBe("20260501");
    expect(e.dtend).toBe("20260502");
  });

  it("handles DTSTART with TZID parameter", () => {
    const event = `BEGIN:VEVENT
SUMMARY:Moscow meeting
DTSTART;TZID=Europe/Moscow:20260410T190000
DTEND;TZID=Europe/Moscow:20260410T200000
UID:tz-test
END:VEVENT`;
    const e = parseVEvent(event);
    expect(e.dtstart).toBe("20260410T190000");
    expect(e.dtend).toBe("20260410T200000");
  });

  it("handles DTSTART with VALUE=DATE-TIME parameter", () => {
    const event = `BEGIN:VEVENT
DTSTART;VALUE=DATE-TIME:20260402T160500Z
DTEND;VALUE=DATE-TIME:20260402T162000Z
UID:dt-test
END:VEVENT`;
    const e = parseVEvent(event);
    expect(e.dtstart).toBe("20260402T160500Z");
    expect(e.dtend).toBe("20260402T162000Z");
  });
});

describe("formatDT", () => {
  it("converts ISO 8601 to iCal basic format", () => {
    expect(formatDT("2026-04-10T14:00:00")).toBe("20260410T140000");
  });

  it("preserves Z suffix for UTC", () => {
    expect(formatDT("2026-04-10T14:00:00Z")).toBe("20260410T140000Z");
  });

  it("strips milliseconds", () => {
    expect(formatDT("2026-04-10T14:00:00.000Z")).toBe("20260410T140000Z");
  });

  it("handles already-formatted input (passthrough)", () => {
    expect(formatDT("20260410T140000Z")).toBe("20260410T140000Z");
  });

  it("handles date-only input", () => {
    expect(formatDT("2026-04-10")).toBe("20260410");
  });
});

describe("unfold", () => {
  it("joins lines that start with a space", () => {
    const folded = "DESCRIPTION:Very long text that\r\n continues on the next line";
    expect(unfold(folded)).toBe("DESCRIPTION:Very long text thatcontinues on the next line");
  });

  it("joins lines that start with a tab", () => {
    const folded = "SUMMARY:Start\r\n\tEnd";
    expect(unfold(folded)).toBe("SUMMARY:StartEnd");
  });

  it("handles LF-only line endings", () => {
    const folded = "NOTE:Line one\n continues";
    expect(unfold(folded)).toBe("NOTE:Line onecontinues");
  });

  it("leaves non-folded text unchanged", () => {
    expect(unfold("SUMMARY:Normal text")).toBe("SUMMARY:Normal text");
  });
});

describe("parseVEvent with folded lines", () => {
  it("parses folded DESCRIPTION correctly", () => {
    const event = `BEGIN:VEVENT
SUMMARY:Meeting
DESCRIPTION:This is a very long description that wraps
 across multiple lines in the iCalendar format
UID:fold-test
END:VEVENT`;
    const e = parseVEvent(event);
    expect(e.description).toBe(
      "This is a very long description that wrapsacross multiple lines in the iCalendar format",
    );
  });
});

describe("dtLine", () => {
  it("formats UTC time with VALUE=DATE-TIME and Z", () => {
    expect(dtLine("DTSTART", "2026-04-10T14:00:00Z")).toBe(
      "DTSTART;VALUE=DATE-TIME:20260410T140000Z",
    );
  });

  it("appends Z to non-UTC time for safety", () => {
    expect(dtLine("DTSTART", "2026-04-10T14:00:00")).toBe(
      "DTSTART;VALUE=DATE-TIME:20260410T140000Z",
    );
  });

  it("works with DTEND", () => {
    expect(dtLine("DTEND", "2026-04-10T15:00:00Z")).toBe("DTEND;VALUE=DATE-TIME:20260410T150000Z");
  });
});
