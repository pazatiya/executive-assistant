import { and, asc, eq, isNull, lte, inArray, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { reminders } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { nowIso, appLocalParts, appLocalDate, addAppLocalDays, appLocalDow } from "@/lib/utils";
import { canAccessRow, listScope } from "@/lib/auth/scope";
import { notify } from "./notifications";
import { logActivity } from "./activity";

export type Reminder = typeof reminders.$inferSelect;

export interface CreateReminderInput {
  userId: string;
  workspaceId?: string | null;
  title: string;
  description?: string;
  kind?: Reminder["kind"];
  dueAt: string; // ISO
  timezone?: string;
  recurrence?: string | null;
  condition?: string | null;
  linkedTaskId?: string | null;
  linkedContactId?: string | null;
}

export async function createReminder(input: CreateReminderInput): Promise<Reminder> {
  // Idempotency guard. Gemini sometimes re-emits the same create_reminder tool
  // call inside one orchestrator run, and a slow webhook can be redelivered by
  // Meta — both produced two identical reminders seconds apart. If an identical
  // one (same owner + workspace + title + time) was just created, reuse it.
  const recent = await db.query.reminders.findFirst({
    where: and(
      eq(reminders.userId, input.userId),
      input.workspaceId ? eq(reminders.workspaceId, input.workspaceId) : isNull(reminders.workspaceId),
      eq(reminders.title, input.title),
      eq(reminders.dueAt, input.dueAt),
    ),
  });
  if (recent && Date.now() - new Date(recent.createdAt).getTime() < 5 * 60_000) {
    return recent;
  }

  const row: Reminder = {
    id: id("rem"),
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    title: input.title,
    description: input.description ?? "",
    kind: input.kind ?? "one_time",
    dueAt: input.dueAt,
    timezone: input.timezone ?? "Asia/Jerusalem",
    recurrence: input.recurrence ?? null,
    condition: input.condition ?? null,
    linkedTaskId: input.linkedTaskId ?? null,
    linkedContactId: input.linkedContactId ?? null,
    status: "scheduled",
    lastFiredAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.insert(reminders).values(row);
  await logActivity({
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    action: `נוצרה תזכורת: ${input.title}`,
    tool: "reminders",
    target: row.id,
    result: "success",
  });
  return row;
}

export async function listReminders(
  userId: string,
  opts: { workspaceId?: string; statuses?: Reminder["status"][] } = {},
) {
  const conds: SQL[] = [
    await listScope({ userId: reminders.userId, workspaceId: reminders.workspaceId }, userId, opts.workspaceId),
  ];
  if (opts.statuses?.length) conds.push(inArray(reminders.status, opts.statuses));
  return db
    .select()
    .from(reminders)
    .where(and(...conds))
    .orderBy(asc(reminders.dueAt));
}

export async function updateReminder(userId: string, remId: string, patch: Partial<Reminder>) {
  const existing = await db.query.reminders.findFirst({ where: eq(reminders.id, remId) });
  if (!existing || !(await canAccessRow(userId, existing))) return null;
  await db.update(reminders).set({ ...patch, updatedAt: nowIso() }).where(eq(reminders.id, remId));
  return db.query.reminders.findFirst({ where: eq(reminders.id, remId) });
}

/**
 * Next occurrence for a recurrence rule, skipping Saturday for "weekdays".
 * Works in Israel calendar days and keeps the wall-clock time, so a daily 15:00
 * reminder stays at 15:00 across the summer/winter clock change instead of
 * drifting an hour (a fixed +24h step did exactly that).
 */
function nextDueAt(from: Date, recurrence: string): string | null {
  if (recurrence === "daily") return addAppLocalDays(from, 1).toISOString();
  if (recurrence === "weekly") return addAppLocalDays(from, 7).toISOString();
  if (recurrence === "weekdays") {
    let next = addAppLocalDays(from, 1);
    while (appLocalDow(next) === 6) next = addAppLocalDays(next, 1); // Israeli work week: skip Saturday
    return next.toISOString();
  }
  if (recurrence === "monthly") {
    const q = appLocalParts(from);
    const lastDay = new Date(Date.UTC(q.y, q.mo + 1, 0)).getUTCDate(); // days in next month
    return appLocalDate(q.y, q.mo + 1, Math.min(q.d, lastDay), q.h, q.mi, q.s).toISOString();
  }
  return null;
}

/**
 * Reminder engine tick — call from a cron / scheduled task. Fires everything due,
 * creates a notification per reminder, and reschedules recurring ones.
 * Returns the reminders that fired.
 */
export async function processDueReminders(now = new Date()): Promise<Reminder[]> {
  const due = await db
    .select()
    .from(reminders)
    .where(and(eq(reminders.status, "scheduled"), lte(reminders.dueAt, now.toISOString())));

  for (const r of due) {
    await notify({
      userId: r.userId,
      workspaceId: r.workspaceId,
      kind: "reminder",
      title: `⏰ ${r.title}`,
      body: r.description || (r.condition ? `תנאי: ${r.condition}` : ""),
      href: "/calendar",
      priority: r.kind === "deadline" ? "high" : "normal",
    });
    await logActivity({
      userId: r.userId,
      workspaceId: r.workspaceId,
      action: `תזכורת הופעלה: ${r.title}`,
      tool: "reminders",
      target: r.id,
      result: "info",
    });

    const nextAt = r.recurrence ? nextDueAt(new Date(r.dueAt), r.recurrence) : null;
    if (nextAt) {
      await db
        .update(reminders)
        .set({ dueAt: nextAt, lastFiredAt: now.toISOString() })
        .where(eq(reminders.id, r.id));
    } else {
      await db
        .update(reminders)
        .set({ status: "fired", lastFiredAt: now.toISOString() })
        .where(eq(reminders.id, r.id));
    }
  }
  return due;
}
