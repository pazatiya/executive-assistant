/**
 * Minimal vCard (2.1 / 3.0 / 4.0) parser — enough to pull name + phone + email
 * + org out of a phone/Google contacts export. No dependency: the format is
 * line-based and we only need a handful of properties.
 */
export interface ParsedContact {
  name: string;
  phone?: string;
  phones: string[];
  email?: string;
  company?: string;
  note?: string;
}

/** Unfold RFC-6350 line folding: a CRLF followed by a space/tab continues the previous line. */
function unfold(raw: string): string[] {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
}

function decodeValue(rawKey: string, value: string): string {
  // QUOTED-PRINTABLE (common in older iOS/Android exports, esp. for Hebrew)
  if (/ENCODING=QUOTED-PRINTABLE/i.test(rawKey)) {
    try {
      const bytes = value
        .replace(/=\n/g, "")
        .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      // the bytes are UTF-8; re-decode
      return decodeURIComponent(escape(bytes));
    } catch {
      return value;
    }
  }
  return value.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").trim();
}

function normalizePhone(p: string): string {
  let s = p.replace(/[^\d+]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  // canonicalise Israeli numbers so "050-465-8889" and "+972504658889" match
  if (/^0\d{8,9}$/.test(s)) s = "+972" + s.slice(1);
  return s;
}

export function parseVCards(text: string): ParsedContact[] {
  const out: ParsedContact[] = [];
  let cur: ParsedContact | null = null;
  let structuredName = "";

  for (const line of unfold(text)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const rawKey = line.slice(0, idx).toUpperCase();
    const key = rawKey.split(";")[0];
    const value = line.slice(idx + 1);

    if (key === "BEGIN") {
      cur = { name: "", phones: [] };
      structuredName = "";
    } else if (key === "END") {
      if (cur) {
        if (!cur.name && structuredName) cur.name = structuredName;
        cur.name = cur.name.trim();
        cur.phone = cur.phones[0];
        if (cur.name || cur.phones.length) out.push(cur);
      }
      cur = null;
    } else if (!cur) {
      continue;
    } else if (key === "FN") {
      cur.name = decodeValue(rawKey, value);
    } else if (key === "N" && !cur.name) {
      // N: Family;Given;Additional;Prefix;Suffix
      const parts = decodeValue(rawKey, value).split(";").map((s) => s.trim());
      structuredName = [parts[3], parts[1], parts[2], parts[0], parts[4]].filter(Boolean).join(" ");
    } else if (key === "TEL") {
      const n = normalizePhone(decodeValue(rawKey, value));
      if (n && n.replace(/\D/g, "").length >= 6 && !cur.phones.includes(n)) cur.phones.push(n);
    } else if (key === "EMAIL" && !cur.email) {
      cur.email = decodeValue(rawKey, value).trim() || undefined;
    } else if (key === "ORG" && !cur.company) {
      cur.company = decodeValue(rawKey, value).split(";")[0].trim() || undefined;
    } else if (key === "NOTE" && !cur.note) {
      cur.note = decodeValue(rawKey, value).trim() || undefined;
    }
  }
  return out;
}
