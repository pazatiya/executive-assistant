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
import { listMessages } from "@/lib/services/messages";
import { canAccessRow, listScope } from "@/lib/auth/scope";
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
  const emRow = emailId ? await db.query.emails.findFirst({ where: eq(emails.id, emailId) }) : null;
  const em = emRow && (await canAccessRow(ctx.userId, emRow)) ? emRow : null;
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
  const mRow = messageId ? await db.query.messages.findFirst({ where: eq(messages.id, messageId) }) : null;
  const m = mRow && (await canAccessRow(ctx.userId, mRow)) ? mRow : null;
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

/**
 * Sends a customer reply RIGHT NOW, no approval step.
 * Only for when the owner (Paz/Yair) dictated the exact wording themselves —
 * the owner's own message *is* the approval. If the model is composing the
 * wording on its own, it must use draft_message_reply instead.
 */
const send_message_now: ToolFn = async (ctx, input) => {
  const messageId = String(input.messageId ?? "");
  const text = String(input.text ?? "");
  if (!text.trim()) return { ok: false, summary: "חסר טקסט לשליחה" };
  const mRow = messageId ? await db.query.messages.findFirst({ where: eq(messages.id, messageId) }) : null;
  const m = mRow && (await canAccessRow(ctx.userId, mRow)) ? mRow : null;
  if (!m) return { ok: false, summary: "לא מצאתי את ההודעה לענות עליה — בדוק messageId מ-get_context" };
  if (m.channel !== "whatsapp") {
    return { ok: false, summary: `ערוץ ${m.channel} לא נתמך לשליחה מיידית — השתמש ב-draft_message_reply` };
  }
  const { sendWhatsApp } = await import("@/lib/integrations/whatsapp-send");
  const r = await sendWhatsApp(m.authorHandle, text);
  if (!r.ok) return { ok: false, summary: `השליחה נכשלה: ${r.error ?? "שגיאה לא ידועה"}` };
  await db.update(messages).set({ status: "replied", draftReply: text }).where(eq(messages.id, messageId));
  return { ok: true, summary: `נשלח מיד ל-${m.authorName || m.authorHandle}`, agent: "social" };
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
    const emailScope = await listScope(
      { userId: emails.userId, workspaceId: emails.workspaceId },
      ctx.userId,
      ctx.workspaceId ?? undefined,
    );
    out.inboxEmails = (await db.select().from(emails).where(and(emailScope, eq(emails.status, "inbox"))))
      .slice(0, 15)
      .map((e) => ({ id: e.id, from: e.fromName || e.fromAddress, subject: e.subject, category: e.category, replyRequired: e.replyRequired }));
  }
  if (kind === "messages") {
    // Not just "new" — a message already auto-acked (e.g. "checking with the
    // store") is exactly the case where the owner comes back later to send
    // the real answer. Excluding anything but "new" made every such
    // follow-up read as "no message found from X".
    // Deliberately NOT scoped to ctx.workspaceId: an owner's WhatsApp command
    // runs against their *personal* workspace by default, but the customer
    // message they're asking about lives in the DALOR business workspace —
    // scoping this to ctx.workspaceId meant it always came back empty for
    // exactly the "reply to a customer" case this is for. listMessages with
    // no workspaceId searches every workspace this user belongs to.
    out.socialInbox = (
      await listMessages(ctx.userId, {
        statuses: ["new", "drafted", "waiting_approval", "replied"],
        limit: 30,
      })
    ).map((m) => ({
      id: m.id,
      channel: m.channel,
      name: m.authorName || null,
      from: m.authorHandle,
      text: m.text,
      classification: m.classification,
      status: m.status,
    }));
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

const check_availability: ToolFn = async (_ctx, input) => {
  const { getDayAvailability } = await import("@/lib/integrations/dalor-barber");
  const { parseAppointmentDate } = await import("./appointment-helper");
  const date = String(input.date ?? "") || parseAppointmentDate(String(input.when ?? "")) || "";
  if (!date) return { ok: false, summary: "צריך תאריך (YYYY-MM-DD) או 'מחר' וכו'" };
  const day = await getDayAvailability(date);
  return {
    ok: true,
    summary: day.freeSlots.length
      ? `${date}: ${day.freeSlots.length} שעות פנויות (${day.freeSlots.slice(0, 10).join(", ")})`
      : `${date}: אין תורים פנויים${day.reason ? ` — ${day.reason}` : ""}`,
    data: { ...day },
    agent: "task",
  };
};

const todays_appointments: ToolFn = async (_ctx, input) => {
  const { listAppointments } = await import("@/lib/integrations/dalor-barber");
  const date = String(input.date ?? new Date().toISOString().slice(0, 10));
  const list = await listAppointments({ date });
  return {
    ok: true,
    summary: list.length ? `${date}: ${list.length} תורים` : `${date}: אין תורים`,
    data: { date, appointments: list },
    agent: "task",
  };
};

const book_appointment: ToolFn = async (ctx, input) => {
  const fullName = String(input.fullName ?? input.name ?? "");
  const phone = String(input.phone ?? "");
  const date = String(input.date ?? "");
  const time = String(input.time ?? "");
  if (!fullName || !phone || !date || !time)
    return { ok: false, summary: "צריך שם, טלפון, תאריך ושעה" };
  const cls = await classifyAction({
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    actionType: "book_appointment",
    targetSystem: "dalor_barber",
  });
  const a = await createApproval({
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    title: `תור: ${fullName} — ${date} ${time}`,
    context: `קביעת תור במספרה עבור ${fullName} (${phone})`,
    actionType: "book_appointment",
    actionPayload: { fullName, phone, date, time, notes: String(input.notes ?? ""), replyTo: phone },
    targetSystem: "dalor_barber",
    riskLevel: cls.riskLevel,
    reason: cls.reason,
    preview: `לקבוע תור ל-${fullName} (${phone}) ל-${date} בשעה ${time}`,
    proposedBy: "task",
    relatedConversationId: ctx.conversationId,
  });
  return { ok: true, summary: `בקשת תור הועלתה לאישור (${date} ${time})`, approvalId: a.id, agent: "task" };
};

const send_catalog_link: ToolFn = async (ctx, input) => {
  const to = String(input.to ?? "");
  const link = "https://dalor.co.il";
  const text =
    String(input.text ?? "") ||
    `אפשר לראות את הקולקציה כאן: ${link} — ואם משהו מוצא חן, כתוב/כתבי לי ואני אבדוק מלאי מול יאיר.`;
  if (to) {
    const { WahaConnector, normalizeChatId } = await import("@/lib/integrations/waha");
    const r = await new WahaConnector().executeAction("send_message", { to: normalizeChatId(to), text });
    return { ok: r.ok, summary: r.ok ? "לינק לקטלוג נשלח" : `שליחה נכשלה: ${r.error}`, agent: "social" };
  }
  return { ok: true, summary: "טקסט לקטלוג מוכן", data: { text }, agent: "social" };
};

const reach_out_to_customer: ToolFn = async (ctx, input) => {
  const phone = String(input.phone ?? input.to ?? "").trim();
  if (!phone) return { ok: false, summary: "צריך מספר טלפון של הלקוח" };
  const { reachOutToCustomer } = await import("@/lib/services/messages");
  const r = await reachOutToCustomer({
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    phone,
    context: String(input.context ?? input.about ?? ""),
    customerName: input.name ? String(input.name) : undefined,
  });
  return {
    ok: r.ok,
    summary: r.ok ? `נפתחה שיחה עם ${phone} (${r.via}) — תופיע ב"הודעות"` : `לא הצלחתי: ${r.error}`,
    agent: "social",
  };
};

/* ────────────────────────── registry + schemas ────────────────────────── */

export const TOOLS: Record<string, ToolFn> = {
  reach_out_to_customer,
  create_task,
  update_task,
  create_reminder,
  create_goal,
  save_memory,
  request_approval,
  draft_email_reply,
  draft_message_reply,
  send_message_now,
  get_context,
  business_advice,
  check_availability,
  todays_appointments,
  book_appointment,
  send_catalog_link,
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
    description: "כשאתה עצמך מנסח את התוכן של תגובה ללקוח (messageId מ-get_context kind=messages) — מכין טיוטה ומעלה לאישור הבעלים, לא נשלח מיד. תלונות תמיד לאישור. אם הבעלים כבר נתנו לך את הנוסח המדויק לשליחה — השתמש ב-send_message_now במקום.",
    parameters: {
      type: "object",
      properties: { messageId: { type: "string" }, text: { type: "string" } },
      required: ["messageId", "text"],
    },
  },
  {
    name: "send_message_now",
    description: "שולח תשובה ללקוח בוואטסאפ מיד, בלי אישור נוסף (messageId מ-get_context kind=messages). השתמש רק כשהבעלים (פז/יאיר) כתבו לך את הנוסח המדויק מילה במילה לשליחה — ההודעה שלהם היא כבר האישור. אם אתה מנסח את התוכן בעצמך — אסור להשתמש בזה, חובה draft_message_reply.",
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
  {
    name: "check_availability",
    description: "בודק אילו תורים פנויים במספרת DALOR ליום מסוים (קריאה בלבד). קבל date ב-YYYY-MM-DD או when כמו 'מחר'.",
    parameters: {
      type: "object",
      properties: { date: { type: "string" }, when: { type: "string" } },
    },
  },
  {
    name: "todays_appointments",
    description: "מחזיר את רשימת התורים במספרה ליום (ברירת מחדל: היום). דורש שאפליקציית התורים מחוברת.",
    parameters: { type: "object", properties: { date: { type: "string" } } },
  },
  {
    name: "book_appointment",
    description:
      "מעלה לאישור קביעת תור במספרה. חובה fullName, phone, date (YYYY-MM-DD), time (HH:MM). לא קובע בפועל עד אישור.",
    parameters: {
      type: "object",
      properties: {
        fullName: { type: "string" },
        phone: { type: "string" },
        date: { type: "string" },
        time: { type: "string" },
        notes: { type: "string" },
      },
      required: ["fullName", "phone", "date", "time"],
    },
  },
  {
    name: "send_catalog_link",
    description:
      "שולח ללקוח לינק לקטלוג הבגדים (או מכין טקסט). לא מנסה למכור לבד — רק מפנה. קבל to (מספר וואטסאפ) ואופציונלי text.",
    parameters: {
      type: "object",
      properties: { to: { type: "string" }, text: { type: "string" } },
    },
  },
  {
    name: "reach_out_to_customer",
    description:
      "פותח שיחת וואטסאפ חדשה עם לקוח שמעולם לא כתב למספר העסקי הרשום במערכת (לדוגמה: כתב לקו הפרטי של פז/יאיר) — דורש תבנית מאושרת ממטא, ולכן עלול להיכשל אם התבנית עדיין 'בבדיקה'. בדוק תמיד קודם עם get_context(kind=messages): אם הלקוח כן מופיע שם (גם אם הסטטוס 'נענה' — כלומר כבר קיבל תשובה אוטומטית וזו חזרה עם התשובה האמיתית) — יש לו כבר הודעה קיימת במערכת, אל תשתמש בכלי הזה בכלל, תשתמש ב-send_message_now/draft_message_reply עם ה-messageId האמיתי שלו.",
    parameters: {
      type: "object",
      properties: {
        phone: { type: "string" },
        context: { type: "string" },
        name: { type: "string" },
      },
      required: ["phone"],
    },
  },
];
