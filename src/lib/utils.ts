import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function nowIso() {
  return new Date().toISOString();
}

/** Relative time in Hebrew, compact. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return "עכשיו";
  if (min < 60) return `לפני ${min} ד׳`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `לפני ${hr} ש׳`;
  const d = Math.round(hr / 24);
  if (d < 7) return `לפני ${d} ימים`;
  return new Date(iso).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "short" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  // Without an explicit timeZone this renders in the SERVER's local time
  // (Render's containers run UTC), not Israel time — every timestamp shown
  // across the app (activity log, tasks, approvals, reminders...) was off by
  // 2-3 hours from what the owner actually sees on her clock.
  return new Date(iso).toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

const APP_TZ = "Asia/Jerusalem";

/**
 * Everything below reads Israel's clock from the tz database (Intl), never from
 * a hard-coded +02:00/+03:00, so the switch between summer and winter time
 * (last Sunday of March / October) needs no code or config change.
 */
const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Israel wall-clock Y/M/D h:m:s at an instant. */
export function appLocalParts(at: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(at).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

/** Minutes Israel's clock leads UTC at an instant: 120 in winter, 180 in summer. */
export function appOffsetMinutes(at: Date): number {
  const q = appLocalParts(at);
  const asUtc = Date.UTC(q.y, q.mo - 1, q.d, q.h, q.mi, q.s);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** The instant at which Israel's wall clock shows this date and time (DST-aware, two-pass like the booking engine). */
export function appLocalDate(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let off = appOffsetMinutes(new Date(guess));
  const t = guess - off * 60000;
  off = appOffsetMinutes(new Date(t));
  return new Date(guess - off * 60000);
}

/** Calendar-day arithmetic on an Israel date, keeping the wall-clock time (a "daily 15:00" stays 15:00 across the clock change). */
export function addAppLocalDays(at: Date, days: number): Date {
  const q = appLocalParts(at);
  const t = new Date(Date.UTC(q.y, q.mo - 1, q.d + days));
  return appLocalDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), q.h, q.mi, q.s);
}

/** Day of week (0=Sunday … 6=Saturday) of the Israel date at an instant. */
export function appLocalDow(at: Date): number {
  const q = appLocalParts(at);
  return new Date(Date.UTC(q.y, q.mo - 1, q.d)).getUTCDay();
}

/**
 * Parses a datetime string the way the app actually means it. A bare
 * "YYYY-MM-DDTHH:MM[:SS]" is Israel local time (that's what the AI is told to
 * write). An explicit Israel offset (+02:00 / +03:00) is ALSO read as Israel
 * wall-clock: the model copies whatever offset it last saw, and a summer
 * "+03:00" on a winter date silently moved reminders an hour early (the
 * 25.10.2026 clock change). 'Z' and any other offset are trusted as real instants.
 */
export function parseAppLocalOrIso(input: string): Date {
  const m = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:\s*\+0?[23](?::?00)?)?$/);
  if (!m) return new Date(input);
  const [, y, mo, d, h, mi, s] = m;
  return appLocalDate(+y, +mo, +d, +h, +mi, +(s ?? 0));
}
