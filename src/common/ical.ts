/** Unfold RFC 5545 line folding (continuation lines start with space or tab) */
export function unfold(text: string): string {
  return text.replace(/\r?\n[ \t]/g, "");
}

/**
 * Extract the value from an iCal property line, handling parameters.
 * e.g. "DTSTART;VALUE=DATE-TIME;TZID=Europe/Moscow:20260402T190500" → "20260402T190500"
 * e.g. "SUMMARY:Team standup" → "Team standup"
 */
function extractValue(line: string): string {
  // Property line format: NAME[;PARAM=VALUE]*:VALUE
  // We need everything after the last unquoted colon
  const colonIdx = line.indexOf(":");
  return colonIdx >= 0 ? line.substring(colonIdx + 1).trim() : line.trim();
}

/** Extract basic event info from iCalendar text */
export function parseVEvent(ical: string) {
  const unfolded = unfold(ical);
  const get = (key: string): string | undefined => {
    const re = new RegExp(`^${key}[;:](.*)$`, "m");
    const m = re.exec(unfolded);
    if (!m) return undefined;
    return extractValue(m[1]);
  };

  return {
    summary: get("SUMMARY") || "(no title)",
    dtstart: get("DTSTART"),
    dtend: get("DTEND"),
    location: get("LOCATION"),
    description: get("DESCRIPTION"),
    uid: get("UID"),
    status: get("STATUS"),
    rrule: get("RRULE"),
  };
}

/** Convert ISO 8601 string to iCalendar DTSTART/DTEND format (basic) */
export function formatDT(iso: string): string {
  return iso
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "")
    .replace(/Z$/, "Z");
}

/**
 * Build DTSTART/DTEND line with proper timezone handling.
 * Uses VALUE=DATE-TIME explicitly for Yandex CalDAV compatibility.
 * - ISO with Z → UTC
 * - ISO without Z → treat as UTC (append Z) for safety
 */
export function dtLine(prop: "DTSTART" | "DTEND", iso: string): string {
  const basic = formatDT(iso);
  const value = basic.endsWith("Z") ? basic : `${basic}Z`;
  return `${prop};VALUE=DATE-TIME:${value}`;
}
