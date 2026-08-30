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
  return new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "short" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("he-IL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
