import { and, asc, eq, lte, inArray, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications, reminders } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { nowIso } from "@/lib/utils";
import { canAccessRow, listScope } from "@/lib/auth/scope";
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

const RECURRENCE_MS: Record<string, number> = {
  daily: 86400000,
  weekdays: 86400000,
  weekly: 604800000,
  monthly: 2592000000,
};

/** Next occurrence for a recurrence rule, skipping Sat for "weekdays". */
function nextDueAt(from: Date, recurrence: string): string | null {
  const step = RECURRENCE_MS[recurrence];
  if (!step) return null;
  let next = new Date(from.getTime() + step);
  if (recurrence === "weekdays") {
    // Israeli work week: skip Saturday (getDay 6); Fri→Sun handled naturally
    while (next.getDay() === 6) next = new Date(next.getTime() + 86400000);
  }
  return next.toISOString();
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
    await db.insert(notifications).values({
      id: id("ntf"),
      userId: r.userId,
      workspaceId: r.workspaceId,
      kind: "reminder",
      title: `תזכורת: ${r.title}`,
      body: r.description || (r.condition ? `תנאי: ${r.condition}` : ""),
      href: "/dashboard",
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
