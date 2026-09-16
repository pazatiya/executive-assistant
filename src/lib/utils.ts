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
 * Parses a datetime string the way the app actually means it: a bare
 * "YYYY-MM-DDTHH:MM[:SS]" with no timezone designator is Israel local time
 * (that's what the AI is told to write for "16:00 today"), not UTC. Handed
 * straight to `new Date(...)` on Render's UTC server, "16:00" was read as
 * 16:00 UTC — Israel 19:00 — so every reminder fired three hours late. A
 * string that already carries a 'Z' or '+HH:MM' offset is trusted as-is.
 */
export function parseAppLocalOrIso(input: string): Date {
  const m = input.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return new Date(input);
  const [, y, mo, d, h, mi, s] = m;
  const guessUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0));
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(guessUtc)).map((x) => [x.type, x.value]));
  const hour = p.hour === "24" ? 0 : Number(p.hour);
  const asIfUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second));
  const offsetMs = asIfUtc - guessUtc; // how far Israel's clock leads UTC at that instant (DST-aware)
  return new Date(guessUtc - offsetMs);
}
