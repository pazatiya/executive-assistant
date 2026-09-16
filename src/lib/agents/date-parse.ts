import { parseAppLocalOrIso } from "@/lib/utils";

/** "YYYY-MM-DDTHH:MM" for a Date's Y/M/D plus a given hour:minute — feeds
 * parseAppLocalOrIso so mock-mode reminders land in Israel local time
 * instead of being read as server-UTC (see parseAppLocalOrIso's comment). */
function localIsoAt(d: Date, hh: number, mm: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hh)}:${pad(mm)}:00`;
}

/** Lightweight Hebrew/relative date parsing for reminders in mock mode. */
export function parseWhen(text: string, base = new Date()): string | null {
  const t = text.trim();

  // explicit ISO
  const iso = t.match(/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/);
  if (iso) return parseAppLocalOrIso(iso[0]).toISOString();

  const inMatch = t.match(/בעוד\s+(\d+)\s*(דק|דקות|שע|שעות|ימים|יום|שבוע|שבועות)/);
  if (inMatch) {
    const n = parseInt(inMatch[1], 10);
    const unit = inMatch[2];
    const ms =
      unit.startsWith("דק") ? n * 60000 :
      unit.startsWith("שע") ? n * 3600000 :
      unit.includes("שבוע") ? n * 604800000 :
      n * 86400000;
    return new Date(base.getTime() + ms).toISOString();
  }

  const timeMatch = t.match(/(\d{1,2}):(\d{2})/);
  const hh = timeMatch ? parseInt(timeMatch[1], 10) : 9;
  const mm = timeMatch ? parseInt(timeMatch[2], 10) : 0;

  const d = new Date(base);
  if (/מחרתיים/.test(t)) d.setDate(d.getDate() + 2);
  else if (/מחר/.test(t)) d.setDate(d.getDate() + 1);
  else if (/היום/.test(t)) {
    /* today */
  } else if (/(שבוע הבא|בשבוע הבא)/.test(t)) d.setDate(d.getDate() + 7);
  else if (timeMatch) {
    // just a time today; if already passed, tomorrow
    let at = parseAppLocalOrIso(localIsoAt(d, hh, mm));
    if (at < base) {
      d.setDate(d.getDate() + 1);
      at = parseAppLocalOrIso(localIsoAt(d, hh, mm));
    }
    return at.toISOString();
  } else {
    return null;
  }
  return parseAppLocalOrIso(localIsoAt(d, hh, mm)).toISOString();
}

export function detectRecurrence(text: string): string | null {
  if (/כל יום|יומי|מדי יום/.test(text)) return "daily";
  if (/כל שבוע|שבועי/.test(text)) return "weekly";
  if (/ימי חול|כל יום עבודה/.test(text)) return "weekdays";
  if (/כל חודש|חודשי/.test(text)) return "monthly";
  return null;
}
