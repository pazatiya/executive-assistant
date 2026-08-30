import type { ToolSchema } from "@/lib/ai/provider";
import type { AgentContext } from "./types";
import { classifyAction, type ActionType } from "@/lib/approval/engine";
import { createTask, updateTask, listTasks } from "@/lib/services/tasks";
import { createReminder } from "@/lib/services/reminders";
import { createGoal } from "@/lib/services/goals";
import { createMemory } from "@/lib/services/memory";
import { createApproval } from "@/lib/services/approvals";
import { listApprovals } from "@/lib/services/approvals";
import { listContacts } from "@/lib/services/contacts";
import { db } from "@/lib/db";
import { emails, messages } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { logActivity } from "@/lib/services/activity";

export interface ToolRunResult {
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
  approvalId?: string;
  taskId?: string;
  reminderId?: string;
  agent?: string;
}

type ToolFn = (ctx: AgentContext, input: Record<string, unknown>) => Promise<ToolRunResult>;

/* ────────────────────────── tool implementations ────────────────────────── */

const create_task: ToolFn = async (ctx, input) => {
  const t = await createTask({
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    title: String(input.title ?? "משימה"),
    description: String(input.description ?? ""),
    priority: (input.priority as "low" | "normal" | "high" | "urgent") ?? "normal",
    dueDate: (input.dueDate as string) ?? null,
    status: input.plan ? "planned" : "inbox",
    createdBy: "assistant",
    source: "assistant",
    requiresApproval: Boolean(input.requiresApproval),
    plan: Array.isArray(input.plan)
      ? (input.plan as string[]).map((step) => ({ step: String(step), status: "pending" as const }))
      : [],
    outcome: (input.outcome as string) ?? null,
  });
  return { ok: true, summary: `נוצרה משימה "${t.title}"`, taskId: t.id, agent: "task", data: { id: t.id } };
};

const update_task: ToolFn = async (ctx, input) => {
  const t = await updateTask(ctx.userId, String(input.taskId), {
    status: input.status as never,
    outcome: (input.note as string) ?? undefined,
  });
  return t
    ? { ok: true, summary: `משימה עודכנה: ${t.title} → ${t.status}`, taskId: t.id, agent: "task" }
    : { ok: false, summary: "לא נמצאה משימה לעדכון" };
};

const create_reminder: ToolFn = async (ctx, input) => {
  if (!input.dueAt) return { ok: false, summary: "חסר מועד לתזכורת (dueAt)" };
  let due = new Date(String(input.dueAt));
  if (isNaN(due.getTime())) return { ok: false, summary: `מועד לא תקין: ${input.dueAt}` };
  // guard against a model returning a stale year — roll forward to a future instant
  const now = Date.now();
  if (due.getTime() < now - 3600_000) {
    const hh = due.getHours();
    const mm = due.getMinutes();
    due = new Date();
    due.setHours(hh, mm, 0, 0);
    if (due.getTime() < now) due.setDate(due.getDate() + 1);
  }
  const r = await createReminder({
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    title: String(input.title ?? "תזכורת"),
    description: String(input.description ?? ""),
    kind: (input.kind as never) ?? "one_time",
    dueAt: due.toISOString(),
    timezone: ctx.timezone,
    recurrence: (input.recurrence as string) ?? null,
    condition: (input.condition as string) ?? null,
  });
  return {
    ok: true,
    summary: `נקבעה תזכורת "${r.title}" ל-${new Date(r.dueAt).toLocaleString("he-IL")}`,
    reminderId: r.id,
    agent: "task",
  };
};

const create_goal: ToolFn = async (ctx, input) => {
  const g = await createGoal({
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    title: String(input.title ?? "מטרה"),
    description: String(input.description ?? ""),
    metric: (input.metric as string) ?? null,
    target: (input.target as string) ?? null,
    deadline: (input.deadline as string) ?? null,
  });
  return { ok: true, summary: `נוצרה מטרה "${g.title}"`, data: { id: g.id }, agent: "business_advisor" };
};

const save_memory: ToolFn = async (ctx, input) => {
  const m = await createMemory({
    userId: ctx.userId,
    workspaceId: input.global ? null : ctx.workspaceId,
    type: (input.type as never) ?? "permanent",
    subject: String(input.subject ?? "הערה"),
    content: String(input.content ?? ""),
    ruleKind: (input.ruleKind as never) ?? null,
    ruleTarget: (input.ruleTarget as string) ?? null,
    importance: (input.importance as never) ?? "normal",
    source: "assistant",
  });
  return { ok: true, summary: `נשמר לזיכרון: ${m.subject}`, data: { id: m.id }, agent: "orchestrator" };
};

const request_approval: ToolFn = async (ctx, input) => {
  const actionType = String(input.actionType ?? "browser_action");
  const cls = await classifyAction({
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    actionType: actionType as ActionType,
    targetSystem: String(input.targetSystem ?? ""),
    target: (input.target as string) ?? undefined,
    negativeSentiment: Boolean(input.negativeSentiment),
  });
  const a = await createApproval({
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    title: String(input.title ?? "אישור נדרש"),
    context: String(input.context ?? ""),
    actionType,
    actionPayload: (input.actionPayload as Record<string, unknown>) ?? {},
    targetSystem: String(input.targetSystem ?? ""),
    riskLevel: cls.riskLevel,
    reason: cls.reason,
    preview: String(input.preview ?? ""),
    proposedBy: String(input.agent ?? "orchestrator"),
    relatedConversationId: ctx.conversationId,
  });
  return {
    ok: true,
    summary: `הועלה לאישור (${cls.riskLevel.toUpperCase()}): ${a.title}`,
    approvalId: a.id,
    agent: String(input.agent ?? "qa_safety"),
  };
};

const draft_email_reply: ToolFn = async (ctx, input) => {
  const emailId = String(input.emailId ?? "");
  const body = String(input.body ?? "");
  const em = emailId
    ? await db.query.emails.findFirst({ where: and(eq(emails.id, emailId), eq(emails.userId, ctx.userId)) })
    : null;
  await db
    .update(emails)
    .set({ draftReply: body, status: "waiting_approval" })
    .where(eq(emails.id, emailId));
  const cls = await classifyAction({
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    actionType: "send_email",
    targetSystem: "gmail",
    target: em?.fromAddress,
  });
  const a = await createApproval({
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    title: `תשובה למייל: ${em?.subject ?? emailId}`,
    context: em ? `מ: ${em.fromName || em.fromAddress}\nנושא: ${em.subject}\n\n${em.snippet}` : "",
    actionType: "send_email",
    actionPayload: { emailId, body, to: em?.fromAddress },
    targetSystem: "gmail",
    riskLevel: cls.riskLevel,
    reason: cls.reason,
    preview: body,
    proposedBy: "email",
    relatedConversationId: ctx.conversationId,
  });
  return { ok: true, summary: `טיוטת תשובה מוכנה וממתינה לאישור`, approvalId: a.id, agent: "email" };
};

const draft_message_reply: ToolFn = async (ctx, input) => {
  const messageId = String(input.messageId ?? "");
  const text = String(input.text ?? "");
  const m = messageId
    ? await db.query.messages.findFirst({ where: and(eq(messages.id, messageId), eq(messages.userId, ctx.userId)) })
    : null;
  await db.update(messages).set({ draftReply: text, status: "waiting_approval" }).where(eq(messages.id, messageId));
  const cls = await classifyAction({
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    actionType: "reply_message",
    targetSystem: m?.channel ?? "instagram",
    negativeSentiment: m?.sentiment === "negative" || m?.classification === "complaint",
  });
  const a = await createApproval({
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    title: `תגובה ב-${m?.channel ?? "רשת חברתית"}: ${m?.authorName || m?.authorHandle || messageId}`,
    context: m ? `${m.authorHandle} (${m.classification}): ${m.text}` : "",
    actionType: "reply_message",
    actionPayload: { messageId, text },
    targetSystem: m?.channel ?? "instagram",
    riskLevel: cls.riskLevel,
    reason: cls.reason,
    preview: text,
    proposedBy: "social",
    relatedConversationId: ctx.conversationId,
  });
  return { ok: true, summary: `תגובה מוכנה וממתינה לאישור`, approvalId: a.id, agent: "social" };
};

const get_context: ToolFn = async (ctx, input) => {
  const kind = String(input.kind ?? "overview");
  const out: Record<string, unknown> = {};
  if (kind === "tasks" || kind === "overview") {
    out.openTasks = (await listTasks(ctx.userId, { workspaceId: ctx.workspaceId })).filter(
      (t) => !["completed", "failed"].includes(t.status),
    ).slice(0, 15).map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority }));
  }
  if (kind === "approvals" || kind === "overview") {
    out.pendingApprovals = (await listApprovals(ctx.userId, { workspaceId: ctx.workspaceId, statuses: ["pending"] })).map(
      (a) => ({ id: a.id, title: a.title, risk: a.riskLevel }),
    );
  }
  if (kind === "emails" || kind === "overview") {
    out.inboxEmails = (
      await db.select().from(emails).where(and(eq(emails.userId, ctx.userId), eq(emails.status, "inbox")))
    )
      .slice(0, 15)
      .map((e) => ({ id: e.id, from: e.fromName || e.fromAddress, subject: e.subject, category: e.category, replyRequired: e.replyRequired }));
  }
  if (kind === "messages") {
    out.socialInbox = (
      await db.select().from(messages).where(and(eq(messages.userId, ctx.userId), eq(messages.status, "new")))
    ).map((m) => ({ id: m.id, channel: m.channel, from: m.authorHandle, text: m.text, classification: m.classification }));
  }
  if (kind === "contacts") {
    out.contacts = (await listContacts(ctx.userId, { workspaceId: ctx.workspaceId })).map((c) => ({
      id: c.id,
      name: c.name,
      company: c.company,
      relationship: c.relationshipType,
      importance: c.importance,
    }));
  }
  return { ok: true, summary: `נטען קונטקסט: ${kind}`, data: out, agent: "research" };
};

const business_advice: ToolFn = async (ctx, input) => {
  const { generateAdvice } = await import("./business-advisor");
  const advice = await generateAdvice(ctx.userId, ctx.workspaceId, String(input.topic ?? ""));
  return { ok: true, summary: "נוצרו המלצות עסקיות", data: { advice }, agent: "business_advisor" };
};

/* ────────────────────────── registry + schemas ────────────────────────── */

export const TOOLS: Record<string, ToolFn> = {
  create_task,
  update_task,
  create_reminder,
  create_goal,
  save_memory,
  request_approval,
  draft_email_reply,
  draft_message_reply,
  get_context,
  business_advice,
};

export async function runTool(name: string, ctx: AgentContext, input: Record<string, unknown>): Promise<ToolRunResult> {
  const fn = TOOLS[name];
  if (!fn) return { ok: false, summary: `כלי לא קיים: ${name}` };
  try {
    const res = await fn(ctx, input);
    await logActivity({
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      agent: res.agent ?? "orchestrator",
      action: res.summary,
      tool: name,
      result: res.ok ? "success" : "failure",
      autoExecuted: true,
    });
    return res;
  } catch (e) {
    return { ok: false, summary: `שגיאה בכלי ${name}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: "get_context",
    description: "טוען מצב נוכחי לפני החלטה: משימות פתוחות, אישורים ממתינים, תיבת מייל, הודעות ברשתות, אנשי קשר.",
    parameters: {
      type: "object",
      properties: { kind: { type: "string", enum: ["overview", "tasks", "approvals", "emails", "messages", "contacts"] } },
      required: ["kind"],
    },
  },
  {
    name: "create_task",
    description: "יוצר משימה חדשה. השתמש כשהמשתמשת מבקשת לטפל במשהו, לעקוב, או לדאוג שדבר ייסגר.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        dueDate: { type: "string", description: "ISO date" },
        plan: { type: "array", items: { type: "string" }, description: "שלבים קונקרטיים" },
        outcome: { type: "string", description: "מה נחשב לתוצאה מוצלחת / סגירה" },
        requiresApproval: { type: "boolean" },
      },
      required: ["title"],
    },
  },
  {
    name: "update_task",
    description: "מעדכן סטטוס משימה קיימת (in_progress / waiting / completed / failed) עם הערה.",
    parameters: {
      type: "object",
      properties: { taskId: { type: "string" }, status: { type: "string" }, note: { type: "string" } },
      required: ["taskId"],
    },
  },
  {
    name: "create_reminder",
    description: "קובע תזכורת. חובה dueAt ב-ISO. ל-follow-up השתמש kind=follow_up. recurrence: daily/weekly/weekdays/monthly.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        dueAt: { type: "string" },
        kind: { type: "string", enum: ["one_time", "recurring", "follow_up", "condition", "deadline", "pre_event"] },
        recurrence: { type: "string" },
        condition: { type: "string" },
      },
      required: ["title", "dueAt"],
    },
  },
  {
    name: "create_goal",
    description: "יוצר מטרה ארוכת טווח עם מדד ויעד (למשל הגדלת מכירות).",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        metric: { type: "string" },
        target: { type: "string" },
        deadline: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "save_memory",
    description:
      "שומר כלל קבוע או ידע. ל'מעכשיו תמיד...' השתמש type=permanent + ruleKind מתאים (always_require_approval / never_delete_from / auto_reply_allowed / writing_style / do_not). global=true אם חל על כל ה-workspaces.",
    parameters: {
      type: "object",
      properties: {
        subject: { type: "string" },
        content: { type: "string" },
        type: { type: "string", enum: ["permanent", "working", "knowledge"] },
        ruleKind: { type: "string" },
        ruleTarget: { type: "string" },
        importance: { type: "string", enum: ["low", "normal", "high", "critical"] },
        global: { type: "boolean" },
      },
      required: ["subject", "content"],
    },
  },
  {
    name: "request_approval",
    description:
      "מעלה פעולה לאישור המשתמשת במקום לבצע אותה. חובה לכל פעולה שאינה GREEN: שליחה, פרסום, שינוי, וכל פעולת RED (כסף/מחיר/מחיקה/הרשאות).",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        context: { type: "string" },
        actionType: { type: "string" },
        targetSystem: { type: "string" },
        target: { type: "string" },
        preview: { type: "string" },
        actionPayload: { type: "object" },
        negativeSentiment: { type: "boolean" },
        agent: { type: "string" },
      },
      required: ["title", "actionType", "preview"],
    },
  },
  {
    name: "draft_email_reply",
    description: "מכין טיוטת תשובה למייל קיים (emailId מ-get_context) ומעלה אותה לאישור לפני שליחה.",
    parameters: {
      type: "object",
      properties: { emailId: { type: "string" }, body: { type: "string" } },
      required: ["emailId", "body"],
    },
  },
  {
    name: "draft_message_reply",
    description: "מכין תגובה להודעה/תגובה ברשת חברתית (messageId מ-get_context kind=messages) ומעלה לאישור. תלונות תמיד לאישור.",
    parameters: {
      type: "object",
      properties: { messageId: { type: "string" }, text: { type: "string" } },
      required: ["messageId", "text"],
    },
  },
  {
    name: "business_advice",
    description: "מפעיל את Business Advisor לזיהוי לידים ללא מענה, צווארי בקבוק, אוטומציות והזדמנויות.",
    parameters: { type: "object", properties: { topic: { type: "string" } } },
  },
];
