import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityLogs, approvals, emails, messages, reminders, tasks } from "@/lib/db/schema";
import { nowIso } from "@/lib/utils";
import { listScope } from "@/lib/auth/scope";

export interface MorningBrief {
  generatedAt: string;
  meetingsToday: { title: string; at: string }[];
  importantEmails: { id: string; from: string; subject: string; priority: string }[];
  newLeads: { id: string; source: string; who: string }[];
  openTasks: { id: string; title: string; status: string; priority: string }[];
  overdueTasks: { id: string; title: string; dueDate: string | null }[];
  waitingApprovals: { id: string; title: string; riskLevel: string }[];
  urgent: string[];
  suggestedOrder: string[];
}

export interface EndOfDayBrief {
  generatedAt: string;
  completed: { id: string; title: string }[];
  stillOpen: { id: string; title: string; status: string }[];
  waiting: { id: string; title: string }[];
  approvals: { id: string; title: string; status: string }[];
  problems: string[];
  suggestionsForTomorrow: string[];
}

export async function buildMorningBrief(userId: string, workspaceId?: string): Promise<MorningBrief> {
  const [taskScope, reminderScope, apprScope, emailScope, msgScope] = await Promise.all([
    listScope({ userId: tasks.userId, workspaceId: tasks.workspaceId }, userId, workspaceId),
    listScope({ userId: reminders.userId, workspaceId: reminders.workspaceId }, userId, workspaceId),
    listScope({ userId: approvals.userId, workspaceId: approvals.workspaceId }, userId, workspaceId),
    listScope({ userId: emails.userId, workspaceId: emails.workspaceId }, userId, workspaceId),
    listScope({ userId: messages.userId, workspaceId: messages.workspaceId }, userId, workspaceId),
  ]);
  const today = new Date();
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59).toISOString();

  const dueReminders = await db
    .select()
    .from(reminders)
    .where(and(reminderScope, eq(reminders.status, "scheduled"), lte(reminders.dueAt, endOfDay)));

  const openTasks = await db
    .select()
    .from(tasks)
    .where(
      and(
        taskScope,
        inArray(tasks.status, ["inbox", "planned", "in_progress", "waiting", "waiting_approval"]),
      ),
    )
    .orderBy(desc(tasks.priority))
    .limit(50);

  const overdue = openTasks.filter((t) => t.dueDate && t.dueDate < nowIso());

  const pendingApprovals = await db
    .select()
    .from(approvals)
    .where(and(apprScope, eq(approvals.status, "pending")));

  const importantEmails = await db
    .select()
    .from(emails)
    .where(and(emailScope, eq(emails.status, "inbox"), inArray(emails.priority, ["high", "urgent"])))
    .limit(20);

  const leadEmails = await db
    .select()
    .from(emails)
    .where(and(emailScope, eq(emails.category, "lead"), eq(emails.status, "inbox")));
  const leadMessages = await db
    .select()
    .from(messages)
    .where(and(msgScope, eq(messages.classification, "lead"), eq(messages.status, "new")));

  const urgent: string[] = [];
  if (overdue.length) urgent.push(`${overdue.length} משימות באיחור`);
  const urgentApprovals = pendingApprovals.filter((a) => a.riskLevel === "red");
  if (urgentApprovals.length) urgent.push(`${urgentApprovals.length} אישורים ברמת RED ממתינים`);
  const complaints = await db
    .select()
    .from(messages)
    .where(and(msgScope, eq(messages.classification, "complaint"), eq(messages.status, "new")));
  if (complaints.length) urgent.push(`${complaints.length} תלונות בערוצים החברתיים`);

  const suggestedOrder: string[] = [
    ...urgent.map((u) => `לטפל קודם: ${u}`),
    ...(pendingApprovals.length ? [`לעבור על ${pendingApprovals.length} אישורים ממתינים`] : []),
    ...(leadEmails.length + leadMessages.length ? [`לחזור ל-${leadEmails.length + leadMessages.length} לידים חדשים`] : []),
    ...(importantEmails.length ? [`לענות ל-${importantEmails.length} מיילים חשובים`] : []),
    ...(openTasks.length ? [`להתקדם עם ${Math.min(3, openTasks.length)} משימות מובילות`] : []),
  ];

  return {
    generatedAt: nowIso(),
    meetingsToday: dueReminders
      .filter((r) => r.kind === "pre_event" || r.kind === "deadline")
      .map((r) => ({ title: r.title, at: r.dueAt })),
    importantEmails: importantEmails.map((e) => ({
      id: e.id,
      from: e.fromName || e.fromAddress,
      subject: e.subject,
      priority: e.priority,
    })),
    newLeads: [
      ...leadEmails.map((e) => ({ id: e.id, source: "email", who: e.fromName || e.fromAddress })),
      ...leadMessages.map((m) => ({ id: m.id, source: m.channel, who: m.authorName || m.authorHandle })),
    ],
    openTasks: openTasks.slice(0, 10).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
    })),
    overdueTasks: overdue.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate })),
    waitingApprovals: pendingApprovals.map((a) => ({ id: a.id, title: a.title, riskLevel: a.riskLevel })),
    urgent,
    suggestedOrder,
  };
}

export interface MiddayBrief {
  generatedAt: string;
  newSinceMorning: { id: string; from: string; text: string; channel: string }[];
  awaitingReply: { id: string; from: string; text: string }[];
  waitingApprovals: { id: string; title: string; riskLevel: string }[];
  nextItems: string[];
}

/** Lightweight midday check-in: what came in, what still needs a reply. */
export async function buildMiddayBrief(userId: string, workspaceId?: string): Promise<MiddayBrief> {
  const since = new Date(Date.now() - 5 * 3600_000).toISOString();
  const [msgScope, apprScope] = await Promise.all([
    listScope({ userId: messages.userId, workspaceId: messages.workspaceId }, userId, workspaceId),
    listScope({ userId: approvals.userId, workspaceId: approvals.workspaceId }, userId, workspaceId),
  ]);

  const recent = await db
    .select()
    .from(messages)
    .where(and(msgScope, gte(messages.receivedAt, since)))
    .orderBy(desc(messages.receivedAt))
    .limit(20);

  const awaiting = await db
    .select()
    .from(messages)
    .where(and(msgScope, inArray(messages.status, ["new", "waiting_approval"])))
    .orderBy(desc(messages.receivedAt))
    .limit(20);

  const pending = await db
    .select()
    .from(approvals)
    .where(and(apprScope, eq(approvals.status, "pending")))
    .orderBy(desc(approvals.createdAt));

  const nextItems: string[] = [];
  if (pending.length) nextItems.push(`${pending.length} אישורים ממתינים`);
  if (awaiting.length) nextItems.push(`${awaiting.length} הודעות בלי מענה`);

  return {
    generatedAt: nowIso(),
    newSinceMorning: recent.map((m) => ({
      id: m.id,
      from: m.authorName || m.authorHandle,
      text: m.text.slice(0, 120),
      channel: m.channel,
    })),
    awaitingReply: awaiting.map((m) => ({ id: m.id, from: m.authorName || m.authorHandle, text: m.text.slice(0, 120) })),
    waitingApprovals: pending.map((a) => ({ id: a.id, title: a.title, riskLevel: a.riskLevel })),
    nextItems,
  };
}

export async function buildEndOfDayBrief(userId: string, workspaceId?: string): Promise<EndOfDayBrief> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [taskScope, apprScope, actScope] = await Promise.all([
    listScope({ userId: tasks.userId, workspaceId: tasks.workspaceId }, userId, workspaceId),
    listScope({ userId: approvals.userId, workspaceId: approvals.workspaceId }, userId, workspaceId),
    listScope({ userId: activityLogs.userId, workspaceId: activityLogs.workspaceId }, userId, workspaceId),
  ]);

  const recentTasks = await db
    .select()
    .from(tasks)
    .where(taskScope)
    .orderBy(desc(tasks.updatedAt))
    .limit(100);

  const completed = recentTasks.filter((t) => t.status === "completed" && (t.completedAt ?? "") >= since);
  const waiting = recentTasks.filter((t) => t.status === "waiting" || t.status === "waiting_approval");
  const stillOpen = recentTasks.filter((t) =>
    ["inbox", "planned", "in_progress"].includes(t.status),
  );

  const todaysApprovals = await db
    .select()
    .from(approvals)
    .where(and(apprScope, gte(approvals.updatedAt, since)));

  const failures = await db
    .select()
    .from(activityLogs)
    .where(and(actScope, eq(activityLogs.result, "failure"), gte(activityLogs.createdAt, since)));

  return {
    generatedAt: nowIso(),
    completed: completed.map((t) => ({ id: t.id, title: t.title })),
    stillOpen: stillOpen.map((t) => ({ id: t.id, title: t.title, status: t.status })),
    waiting: waiting.map((t) => ({ id: t.id, title: t.title })),
    approvals: todaysApprovals.map((a) => ({ id: a.id, title: a.title, status: a.status })),
    problems: failures.map((f) => `${f.action}${f.error ? ` — ${f.error}` : ""}`),
    suggestionsForTomorrow: [
      ...(waiting.length ? [`לוודא מענה על ${waiting.length} פריטים שממתינים`] : []),
      ...(stillOpen.length ? [`לקבוע מועד ל-${stillOpen.length} משימות פתוחות`] : []),
      "לפתוח את הבוקר עם ה-Morning Brief ולסדר עדיפויות",
    ],
  };
}
