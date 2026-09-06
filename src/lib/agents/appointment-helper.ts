/** Parse a target date + optional time from a Hebrew customer message about a barber appointment. */
import { env } from "@/lib/env";

const DOW: Record<string, number> = {
  ראשון: 0, שני: 1, שלישי: 2, רביעי: 3, חמישי: 4, שישי: 5, שבת: 6,
  "א": 0, "ב": 1, "ג": 2, "ד": 3, "ה": 4, "ו": 5,
};

function todayInTz(): Date {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: env.appTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(`${s}T12:00:00`);
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" or null. Handles היום / מחר / מחרתיים / יום <שם> / <שם> הבא / dd/mm. */
export function parseAppointmentDate(text: string): string | null {
  const t = text.trim();
  const base = todayInTz();

  const isoM = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoM) return isoM[0];

  const dm = t.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/);
  if (dm) {
    const day = Number(dm[1]);
    const mon = Number(dm[2]) - 1;
    const year = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : base.getFullYear();
    const d = new Date(year, mon, day, 12);
    if (!Number.isNaN(d.getTime())) return iso(d);
  }

  if (/מחרתיים/.test(t)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 2);
    return iso(d);
  }
  if (/מחר/.test(t)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 1);
    return iso(d);
  }
  if (/היום|הערב|אחה"?צ|אחר.?הצהריים/.test(t)) return iso(base);

  const dowM = t.match(/(?:יום\s+)?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)/);
  if (dowM) {
    const target = DOW[dowM[1]];
    const d = new Date(base);
    let add = (target - d.getDay() + 7) % 7;
    if (add === 0) add = 7; // "יום ראשון" means the next one
    if (/הבא/.test(t) && add <= 7) add += 0; // already the next occurrence
    d.setDate(d.getDate() + add);
    return iso(d);
  }

  return null;
}

/** "HH:MM" or null. Accepts "3", "15:00", "ב-3", "בשלוש". */
export function parseAppointmentTime(text: string): string | null {
  const hhmm = text.match(/(\d{1,2}):(\d{2})/);
  if (hhmm) {
    const h = Number(hhmm[1]);
    const m = Number(hhmm[2]);
    if (h < 24 && m < 60) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  // "ב-3" / "בשעה 3" / "ל15" — a bare hour, assume afternoon if <8
  const bare = text.match(/(?:ב־|ב-|בשעה\s*|ל־|ל-|בשביל\s*)?\b([01]?\d|2[0-3])\b(?!\s*(?:₪|שקל|ש"ח|מידה|דק))/);
  if (bare) {
    let h = Number(bare[1]);
    if (h >= 1 && h <= 7) h += 12; // 1–7 → afternoon (barber closes 20:00)
    if (h >= 8 && h <= 20) return `${String(h).padStart(2, "0")}:00`;
  }
  return null;
}
