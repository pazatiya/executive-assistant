/**
 * DALOR barber booking — talks to the live app at dalorbook.duckdns.org
 * (Express + Firestore, admin key in DALOR_BARBER_ADMIN_KEY).
 *
 * Public:  GET /api/availability?date=  ·  GET /api/day-status  ·  POST /api/appointments
 * Admin:   GET /api/admin/appointments?date=|from=&to=   (header x-admin-key)
 *
 * Slot math mirrors getSlots() in the booking app's public/index.html so the
 * assistant offers exactly the times the site would.
 */
import { env } from "@/lib/env";
import { BaseConnector, type Capability, type Connector, type ConnectorActionResult } from "./connector";

const cap = (key: string, label: string, risk: Capability["risk"]): Capability => ({ key, label, risk });
const SLOT_MIN = 20;
const OPEN_MIN = 8 * 60;

// Jewish-holiday full closures / half days — copied verbatim from the booking app.
const CLOSED = new Set([
  "2025-09-22","2025-09-23","2025-10-01","2025-10-06","2025-10-07","2025-10-08","2025-10-09","2025-10-10","2025-10-11","2025-10-12","2025-10-13",
  "2026-04-01","2026-04-02","2026-04-03","2026-04-04","2026-04-05","2026-04-06","2026-04-07",
  "2026-05-21","2026-09-11","2026-09-12","2026-09-20",
  "2026-09-25","2026-09-26","2026-09-27","2026-09-28","2026-09-29","2026-09-30","2026-10-01","2026-10-02",
  "2027-04-21","2027-04-22","2027-04-23","2027-04-24","2027-04-25","2027-04-26","2027-04-27",
  "2027-06-10","2027-10-01","2027-10-02","2027-10-10",
  "2027-10-15","2027-10-16","2027-10-17","2027-10-18","2027-10-19","2027-10-20","2027-10-21","2027-10-22",
]);
const HALF = new Set([
  "2025-09-21","2025-09-30","2025-10-05",
  "2026-03-31","2026-05-20","2026-09-10","2026-09-19","2026-09-24",
  "2027-04-20","2027-06-09","2027-09-30","2027-10-09","2027-10-14",
]);

function isSummerIL(d: Date): boolean {
  const m = d.getMonth();
  if (m >= 10 || m <= 1) return false;
  if (m >= 3 && m <= 8) return true;
  if (m === 2) {
    const ld = new Date(d.getFullYear(), 3, 0);
    while (ld.getDay() !== 5) ld.setDate(ld.getDate() - 1);
    return d.getDate() >= ld.getDate();
  }
  const ld = new Date(d.getFullYear(), 10, 0);
  while (ld.getDay() !== 0) ld.setDate(ld.getDate() - 1);
  return d.getDate() < ld.getDate();
}

function todayISOInTz(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: env.appTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}
function nowMinutesInTz(): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: env.appTimezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
}

export interface DayInfo {
  date: string;
  closed: boolean;
  reason?: string; // "שבת" | "חג" | day-status label
  freeSlots: string[]; // "HH:MM"
  bookedCount: number;
}

/** Compute the bookable slots for a date given the app's public availability data. */
export function computeDay(
  date: string,
  data: { booked?: string[]; closeAt?: string | null; dayStatus?: Record<string, { type: string; note?: string; closeAt?: string }> },
): DayInfo {
  const d = new Date(`${date}T12:00:00`);
  const dow = d.getDay();
  const booked = new Set(data.booked ?? []);
  const status = data.dayStatus?.[date];

  if (dow === 6) return { date, closed: true, reason: "שבת", freeSlots: [], bookedCount: booked.size };
  if (CLOSED.has(date)) return { date, closed: true, reason: "חג", freeSlots: [], bookedCount: booked.size };
  if (status && ["vacation", "closed", "busy"].includes(status.type)) {
    const label = { vacation: "יאיר בחופשה", closed: "המספרה סגורה", busy: "היום מלא" }[status.type as "vacation"];
    return { date, closed: true, reason: label, freeSlots: [], bookedCount: booked.size };
  }
  if (status && ["phone_only", "walkin_only"].includes(status.type)) {
    const label = status.type === "phone_only" ? "תורים טלפוניים בלבד" : "הגעה ישירה בלבד (בלי הזמנה)";
    return { date, closed: true, reason: label, freeSlots: [], bookedCount: booked.size };
  }

  let endMin =
    HALF.has(date) ? 14 * 60 : dow === 5 ? (isSummerIL(d) ? 15 * 60 + 30 : 14 * 60) : 20 * 60;
  const closeAt = status?.closeAt ?? data.closeAt ?? null;
  if (closeAt) {
    const [h, m] = closeAt.split(":").map(Number);
    endMin = Math.min(endMin, h * 60 + m);
  }

  const out: string[] = [];
  for (let m = OPEN_MIN; m + SLOT_MIN <= endMin; m += SLOT_MIN) {
    const t = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    if (booked.has(t)) continue;
    out.push(t);
  }

  let free = out;
  if (date === todayISOInTz()) {
    const nm = nowMinutesInTz();
    free = out.filter((t) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m > nm;
    });
  }
  return { date, closed: free.length === 0, reason: status?.note, freeSlots: free, bookedCount: booked.size };
}

async function barberFetch<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; admin?: boolean } = {},
): Promise<{ status: number | null; body: T | null }> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.admin) headers["x-admin-key"] = env.dalorBarberAdminKey;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${env.dalorBarberUrl}${path}`, {
      method: opts.method ?? (opts.body ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let body: T | null = null;
    try {
      body = text ? (JSON.parse(text) as T) : null;
    } catch {
      body = text as unknown as T;
    }
    return { status: res.status, body };
  } catch {
    return { status: null, body: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function getDayAvailability(date: string): Promise<DayInfo> {
  const [avail, dayStatus] = await Promise.all([
    barberFetch<{ booked?: string[]; closeAt?: string | null }>(`/api/availability?date=${date}`),
    barberFetch<Record<string, { type: string; note?: string; closeAt?: string }>>(`/api/day-status`),
  ]);
  return computeDay(date, {
    booked: avail.body?.booked ?? [],
    closeAt: avail.body?.closeAt ?? null,
    dayStatus: dayStatus.body ?? {},
  });
}

export interface BookingInput {
  fullName: string;
  phone: string;
  date: string;
  time: string;
  notes?: string;
}

export async function createBooking(input: BookingInput): Promise<ConnectorActionResult> {
  const { status, body } = await barberFetch<{ id?: string; error?: string }>(`/api/appointments`, {
    body: {
      fullName: input.fullName,
      phone: input.phone,
      date: input.date,
      time: input.time,
      notes: input.notes ?? "נקבע ע\"י המזכירה הדיגיטלית",
    },
  });
  if (status === 200 || status === 201) return { ok: true, detail: `תור נקבע ל-${input.date} ${input.time}`, data: { id: body?.id } };
  if (status === 409) return { ok: false, detail: "", error: "המשבצת נתפסה בינתיים — צריך לבחור שעה אחרת" };
  return { ok: false, detail: "", error: (body as { error?: string })?.error ?? `שגיאה מהמערכת (HTTP ${status ?? "no response"})` };
}

export interface AdminAppointment {
  id: string;
  fullName: string;
  phone: string;
  date: string;
  time: string;
  status: string;
  notes?: string;
  source?: string;
}

export async function listAppointments(params: { date?: string; from?: string; to?: string }): Promise<AdminAppointment[]> {
  const qs = params.date
    ? `date=${params.date}`
    : `from=${params.from ?? ""}&to=${params.to ?? ""}`;
  const { status, body } = await barberFetch<AdminAppointment[]>(`/api/admin/appointments?${qs}`, { admin: true });
  if (status !== 200 || !Array.isArray(body)) return [];
  return body
    .filter((a) => a.status !== "cancelled")
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

export class DalorBarberConnector extends BaseConnector {
  provider = "dalor_barber";
  displayName = "DALOR — תורים";
  category = "custom" as const;

  listCapabilities() {
    return [
      cap("check_availability", "בדיקת זמינות תור", "green"),
      cap("list_appointments", "רשימת תורים", "green"),
      cap("book_appointment", "קביעת תור", "yellow"),
    ];
  }

  async connect() {
    if (!env.dalorBarberAdminKey)
      return { fields: [{ key: "admin_key", label: "מפתח אדמין של אפליקציית התורים", secret: true }], message: "הגדירו DALOR_BARBER_ADMIN_KEY ב-.env.local" };
    return { redirectUrl: "/api/integrations/dalor_barber/connect", message: "בודק חיבור לאפליקציית התורים…" };
  }

  async testConnection() {
    const { status } = await barberFetch("/api/admin/auth", { admin: true });
    return status === 200
      ? { ok: true, detail: "מחובר לאפליקציית התורים של DALOR" }
      : { ok: false, detail: `אפליקציית התורים החזירה ${status ?? "אין תגובה"}` };
  }

  async fetchData(resource: string, params: Record<string, unknown> = {}) {
    if (resource === "availability") {
      const date = String(params.date ?? "");
      if (!date) return { ok: false, items: [], detail: "date נדרש" };
      const day = await getDayAvailability(date);
      return { ok: true, items: [day] };
    }
    if (resource === "appointments") {
      const list = await listAppointments({
        date: params.date as string | undefined,
        from: params.from as string | undefined,
        to: params.to as string | undefined,
      });
      return { ok: true, items: list };
    }
    return { ok: false, items: [], detail: `resource לא נתמך: ${resource}` };
  }

  async executeAction(action: string, payload: Record<string, unknown>): Promise<ConnectorActionResult> {
    if (action === "book_appointment") {
      return createBooking({
        fullName: String(payload.fullName ?? payload.name ?? ""),
        phone: String(payload.phone ?? ""),
        date: String(payload.date ?? ""),
        time: String(payload.time ?? ""),
        notes: payload.notes ? String(payload.notes) : undefined,
      });
    }
    return { ok: false, detail: "", error: `פעולה לא נתמכת: ${action}` };
  }
}

export function makeDalorBarberConnector(provider: string): Connector | null {
  return provider === "dalor_barber" ? new DalorBarberConnector() : null;
}
