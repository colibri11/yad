/** Unfold RFC 5545 line folding (continuation lines start with space or tab) */
export function unfold(text: string): string {
  return text.replace(/\r?\n[ \t]/g, "");
}

/** Extract basic event info from iCalendar text */
export function parseVEvent(ical: string) {
  const unfolded = unfold(ical);
  const get = (key: string): string | undefined => {
    const re = new RegExp(`^${key}[;:](.*)$`, "m");
    const m = re.exec(unfolded);
    return m ? m[1].trim() : undefined;
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
 * - ISO with Z → UTC (append Z)
 * - ISO without Z → treat as UTC (append Z) for safety
 */
export function dtLine(prop: "DTSTART" | "DTEND", iso: string): string {
  const basic = formatDT(iso);
  if (basic.endsWith("Z")) return `${prop}:${basic}`;
  return `${prop}:${basic}Z`;
}
