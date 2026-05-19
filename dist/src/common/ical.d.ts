/** Unfold RFC 5545 line folding (continuation lines start with space or tab) */
export declare function unfold(text: string): string;
/** Extract basic event info from iCalendar text.
 *  Parses only inside BEGIN:VEVENT...END:VEVENT to avoid
 *  picking up properties from VTIMEZONE or other components. */
export declare function parseVEvent(ical: string): {
    summary: string;
    dtstart: string | undefined;
    dtend: string | undefined;
    location: string | undefined;
    description: string | undefined;
    uid: string | undefined;
    status: string | undefined;
    rrule: string | undefined;
};
/** Convert ISO 8601 string to iCalendar DTSTART/DTEND format (basic) */
export declare function formatDT(iso: string): string;
/**
 * Build DTSTART/DTEND line with proper timezone handling.
 * Uses VALUE=DATE-TIME explicitly for Yandex CalDAV compatibility.
 * - ISO with Z → UTC
 * - ISO without Z → treat as UTC (append Z) for safety
 */
export declare function dtLine(prop: "DTSTART" | "DTEND", iso: string): string;
