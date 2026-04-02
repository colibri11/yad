/** Extract basic event info from iCalendar text */
export function parseVEvent(ical: string) {
  const get = (key: string): string | undefined => {
    const re = new RegExp(`^${key}[;:](.*)$`, "m");
    const m = re.exec(ical);
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
