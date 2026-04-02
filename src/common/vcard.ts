/** Unfold RFC 6350 line folding (continuation lines start with space or tab) */
function unfold(text: string): string {
  return text.replace(/\r?\n[ \t]/g, "");
}

/** Parse basic contact info from vCard text */
export function parseVCard(vcard: string) {
  const unfolded = unfold(vcard);
  const get = (key: string): string | undefined => {
    const re = new RegExp(`^${key}[;:](.*)$`, "m");
    const m = re.exec(unfolded);
    return m ? m[1].trim() : undefined;
  };

  const getAll = (key: string): string[] => {
    const results: string[] = [];
    const re = new RegExp(`^${key}[;:](.*)$`, "gm");
    for (let m = re.exec(unfolded); m !== null; m = re.exec(unfolded)) {
      results.push(m[1].trim());
    }
    return results;
  };

  const fn = get("FN");
  const n = get("N");
  const tels = getAll("TEL");
  const emails = getAll("EMAIL");
  const org = get("ORG");
  const title = get("TITLE");
  const note = get("NOTE");
  const uid = get("UID");

  return {
    fullName: fn || "(no name)",
    name: n,
    phones: tels.map((t) => {
      // TEL;TYPE=CELL:+7...  or  TEL:+7...
      const parts = t.split(":");
      return parts.length > 1 ? parts.slice(1).join(":") : parts[0];
    }),
    emails: emails.map((e) => {
      const parts = e.split(":");
      return parts.length > 1 ? parts.slice(1).join(":") : parts[0];
    }),
    organization: org,
    title,
    note,
    uid,
  };
}
