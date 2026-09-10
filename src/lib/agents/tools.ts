import type { ToolSchema } from "@/lib/ai/provider";
import type { AgentContext } from "./types";
import { classifyAction, ACTION_CATALOG, type ActionType } from "@/lib/approval/engine";
import { createTask, updateTask, listTasks } from "@/lib/services/tasks";
import { createReminder, listReminders } from "@/lib/services/reminders";
import { createGoal } from "@/lib/services/goals";
import { createMemory } from "@/lib/services/memory";
import { createApproval, decideApproval, listApprovals } from "@/lib/services/approvals";
import { listContacts } from "@/lib/services/contacts";
import { listMessages } from "@/lib/services/messages";
import { getMessages as getConversationMessages } from "@/lib/services/conversations";
import { canAccessRow, listScope } from "@/lib/auth/scope";
import { db } from "@/lib/db";
import { emails, messages, workspaces } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { logActivity } from "@/lib/services/activity";
import { env } from "@/lib/env";

/**
 * A task/reminder created from an owner's WhatsApp message always defaults
 * to ctx.workspaceId — their *personal* workspace — regardless of what it's
 * actually about. "remind me to call the supplier" belongs there; "follow up
 * with Avi about polo shirts" belongs in the DALOR business workspace. Let
 * the model say which, instead of everything silently landing in personal.
 */
async function resolveTargetWorkspaceId(ctx: AgentContext, workspace: unknown): Promise<string> {
  if (workspace === "business") {
    const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, env.whatsappWorkspaceSlug) });
    if (ws) return ws.id;
  }
  return ctx.workspaceId;
}

export interface ToolRunResult {
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
  approvalId?: string;
  taskId?: string;
  reminderId?: string;
  agent?: string;
  // The customer phone this tool call spoke to, when applicable — recorded on
  // the activity log so message-responder can tell "the owner is personally
  // handling this customer right now" and never auto-reply over them (see
  // ownerHandledRecently in message-responder.ts).
  target?: string;
}

type ToolFn = (ctx: AgentContext, input: Record<string, unknown>) => Promise<ToolRunResult>;

/* ────────────────────────── tool implementations ────────────────────────── */

const create_task: ToolFn = async (ctx, input) => {
  const t = await createTask({
    userId: ctx.userId,
    workspaceId: await resolveTargetWorkspaceId(ctx, input.workspace),
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
    workspaceId: await resolveTargetWorkspaceId(ctx, input.workspace),
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

/**
 * Decides an approval that's already pending — for when the user confirms in
 * their own words ("מאשרת", "כן תמחק אותה", "סבבה תבצע") rather than the exact
 * "אשר"/"דחה" the WhatsApp fast-path regex expects. Without this the model had
 * no way to act on a clear yes/no and would either re-create a duplicate
 * approval for the same thing or simply give up and claim it's not possible.
 */
const decide_approval: ToolFn = async (ctx, input) => {
  const approvalId = String(input.approvalId ?? "");
  const decision = input.decision === "reject" ? "reject" : "approve";
  if (!approvalId) return { ok: false, summary: "חסר approvalId — קבל אותו מ-get_context kind=approvals" };
  const r = await decideApproval(ctx.userId, approvalId, decision, { decidedBy: "assistant (בשם המשתמשת)" });
  if (!r.ok) return { ok: false, summary: r.error === "not_found" ? "האישור לא נמצא" : `כבר טופל (${r.error})` };
  return { ok: true, summary: decision === "approve" ? "האישור בוצע." : "האישור נדחה.", agent: "qa_safety" };
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
  return { ok: true, summary: `נשלח מיד ל-${m.authorName || m.authorHandle}`, agent: "social", target: m.authorHandle };
};

/** Forwards a photo the owner sent us (see imageMediaId in the conversation)
 * to a customer, identified the same way as send_message_now. */
const send_image_to_customer: ToolFn = async (ctx, input) => {
  const messageId = String(input.messageId ?? "");
  // Accept either one id or a batch — get_context(kind="pendingImages") is
  // built for handing over everything the owner just dropped in one call,
  // instead of one tool call (and one confirmation) per photo.
  const ids = Array.isArray(input.imageMediaIds)
    ? (input.imageMediaIds as unknown[]).map(String).filter(Boolean)
    : input.imageMediaId
      ? [String(input.imageMediaId)]
      : [];
  if (!ids.length) return { ok: false, summary: "חסר imageMediaId/imageMediaIds — זה מגיע מ-get_context kind=pendingImages" };
  const mRow = messageId ? await db.query.messages.findFirst({ where: eq(messages.id, messageId) }) : null;
  const m = mRow && (await canAccessRow(ctx.userId, mRow)) ? mRow : null;
  if (!m) return { ok: false, summary: "לא מצאתי את ההודעה לשלוח אליה — בדוק messageId מ-get_context" };
  if (m.channel !== "whatsapp") {
    return { ok: false, summary: `ערוץ ${m.channel} לא נתמך לשליחת תמונה` };
  }
  const { forwardImageToCustomer } = await import("@/lib/integrations/meta-whatsapp");
  let sent = 0;
  const errors: string[] = [];
  for (const mediaId of ids) {
    const r = await forwardImageToCustomer(m.authorHandle, mediaId, ids.length === 1 && input.caption ? String(input.caption) : undefined);
    if (r.ok) sent++;
    else errors.push(r.error ?? "שגיאה לא ידועה");
    if (ids.length > 1) await new Promise((res) => setTimeout(res, 400)); // don't hammer the Graph API back-to-back
  }
  if (!sent) return { ok: false, summary: `שליחת התמונות נכשלה: ${errors[0] ?? "שגיאה לא ידועה"}` };
  return {
    ok: true,
    summary: `${sent}/${ids.length} תמונות נשלחו ל-${m.authorName || m.authorHandle}${errors.length ? ` (${errors.length} נכשלו)` : ""}`,
    agent: "social",
    target: m.authorHandle,
  };
};

const get_context: ToolFn = async (ctx, input) => {
  const kind = String(input.kind ?? "overview");
  const out: Record<string, unknown> = {};
  // Same reasoning as the messages branch below: an owner's WhatsApp command
  // runs against their personal workspace, but a task/approval created about
  // a DALOR customer lives in the business workspace — scoping to
  // ctx.workspaceId made those invisible to get_context, so the model had no
  // real id to act on (e.g. closing the very task it had just created).
  if (kind === "tasks" || kind === "overview") {
    out.openTasks = (await listTasks(ctx.userId, {})).filter(
      (t) => !["completed", "failed"].includes(t.status),
    ).slice(0, 15).map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority }));
  }
  if (kind === "reminders" || kind === "overview") {
    // There was previously no way at all for the model to check this — only
    // create_reminder existed, no listing — so "do I have any reminders?"
    // could only ever be a guess.
    out.activeReminders = (await listReminders(ctx.userId, { statuses: ["scheduled", "snoozed"] }))
      .slice(0, 15)
      .map((r) => ({ id: r.id, title: r.title, dueAt: r.dueAt, kind: r.kind, status: r.status }));
  }
  if (kind === "pendingImages") {
    // Photos the owner sent us, accumulated silently (see owner-commands.ts —
    // each one arrives as its own WhatsApp message and is stored without
    // triggering a reply). Scanning the last 30 minutes of this conversation
    // for the imageMediaId tag is how the model finds "all of them" for a
    // batch send, instead of only whichever one happens to still be in its
    // recent-turns window.
    const since = new Date(Date.now() - 30 * 60_000).toISOString();
    const recent = ctx.conversationId ? await getConversationMessages(ctx.conversationId) : [];
    const seen = new Set<string>();
    out.pendingImages = recent
      .filter((r) => r.role === "user" && r.createdAt >= since)
      .flatMap((r) => [...r.content.matchAll(/imageMediaId="([^"]+)"(?:\s+caption="([^"]*)")?/g)])
      .map((mm) => ({ mediaId: mm[1], caption: mm[2] || undefined }))
      .filter((p) => (seen.has(p.mediaId) ? false : (seen.add(p.mediaId), true)))
      .slice(-50);
  }
  if (kind === "approvals" || kind === "overview") {
    out.pendingApprovals = (await listApprovals(ctx.userId, { statuses: ["pending"] })).map(
      (a) => ({ id: a.id, title: a.title, risk: a.riskLevel }),
    );
  }
  if (kind === "emails" || kind === "overview") {
    // Not scoped to ctx.workspaceId either — same reasoning as tasks/messages.
    const emailScope = await listScope({ userId: emails.userId, workspaceId: emails.workspaceId }, ctx.userId);
    out.inboxEmails = (await db.select().from(emails).where(and(emailScope, eq(emails.status, "inbox"))))
      .slice(0, 15)
      .map((e) => ({ id: e.id, from: e.fromName || e.fromAddress, subject: e.subject, category: e.category, replyRequired: e.replyRequired }));
  }
  if (kind === "messages" || kind === "overview") {
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
  if (kind === "contacts" || kind === "overview") {
    // The book can hold hundreds of entries — dumping all of them bloats every
    // overview. Show the important ones; use find_contact to look someone up.
    const all = await listContacts(ctx.userId, {});
    out.contacts = all
      .filter((c) => c.importance === "vip" || c.importance === "high")
      .slice(0, 40)
      .map((c) => ({ id: c.id, name: c.name, phone: c.phone, relationship: c.relationshipType, importance: c.importance }));
    out.contactsTotal = all.length;
    if (all.length > (out.contacts as unknown[]).length) {
      out.contactsHint = "יש עוד אנשי קשר — חפשי מישהו ספציפי עם find_contact(query).";
    }
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

/**
 * A real backstop, not just a prompt instruction: reject anything that isn't
 * shaped like an actual Israeli mobile number — catches a fabricated
 * placeholder (e.g. "972000000000") even if the model ignores the system
 * prompt telling it never to invent one.
 */
function looksLikeRealIsraeliMobile(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.startsWith("972") ? digits : digits.startsWith("0") ? `972${digits.slice(1)}` : digits;
  if (!/^9725\d{8}$/.test(normalized)) return false;
  if (/^(\d)\1+$/.test(normalized)) return false; // all one repeated digit
  return true;
}

const reach_out_to_customer: ToolFn = async (ctx, input) => {
  const phone = String(input.phone ?? input.to ?? "").trim();
  if (!phone) return { ok: false, summary: "צריך מספר טלפון של הלקוח" };
  if (!looksLikeRealIsraeliMobile(phone)) {
    return { ok: false, summary: `"${phone}" לא נראה כמו מספר נייד ישראלי אמיתי — אל תמציאי מספר, תשאלי את המשתמשת מה המספר האמיתי.` };
  }
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
    target: phone,
  };
};

const message_customer: ToolFn = async (ctx, input) => {
  const phone = String(input.phone ?? input.to ?? "").trim();
  const body = String(input.body ?? input.text ?? input.message ?? "").trim();
  if (!phone) return { ok: false, summary: "צריך מספר טלפון של הלקוח" };
  if (!body) return { ok: false, summary: "צריך את תוכן ההודעה לשליחה" };
  if (!looksLikeRealIsraeliMobile(phone)) {
    return { ok: false, summary: `"${phone}" לא נראה כמו מספר נייד ישראלי אמיתי — אל תמציאי מספר, תשאלי את המשתמשת מה המספר האמיתי.` };
  }
  const { messageCustomer } = await import("@/lib/services/messages");
  const r = await messageCustomer({
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    phone,
    body,
    customerName: input.name ? String(input.name) : undefined,
  });
  return {
    ok: r.ok,
    summary: r.ok
      ? `ההודעה נשלחה ל-${phone}${r.via === "meta-template" ? " (כתבנית — מחוץ לחלון 24 שעות)" : ""} — תופיע ב"הודעות"`
      : `לא הצלחתי: ${r.error}`,
    agent: "social",
    target: phone,
  };
};

const find_contact: ToolFn = async (ctx, input) => {
  const query = String(input.query ?? input.name ?? "").trim();
  if (!query) return { ok: false, summary: "צריך שם או חלק ממנו לחיפוש" };
  const { searchContacts } = await import("@/lib/services/contacts");
  const hits = await searchContacts(ctx.userId, query, { limit: 8 });
  if (!hits.length) return { ok: true, summary: `לא נמצא איש קשר שמתאים ל"${query}"`, data: { contacts: [] }, agent: "research" };
  return {
    ok: true,
    summary: `נמצאו ${hits.length} התאמות ל"${query}"`,
    data: {
      contacts: hits.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        company: c.company,
        relationship: c.relationshipType,
        notes: c.notes || undefined,
      })),
    },
    agent: "research",
  };
};

const save_contact: ToolFn = async (ctx, input) => {
  const name = String(input.name ?? "").trim();
  if (!name) return { ok: false, summary: "צריך שם לאיש הקשר" };
  const phone = input.phone ? String(input.phone).trim() : null;
  const { createContact } = await import("@/lib/services/contacts");
  const { listContacts } = await import("@/lib/services/contacts");
  // don't duplicate someone already in the book
  const existing = await listContacts(ctx.userId, ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {});
  const digits = (phone ?? "").replace(/\D/g, "");
  const dup = existing.find(
    (c) => (digits && (c.phone ?? "").replace(/\D/g, "") === digits) || c.name.trim() === name,
  );
  if (dup) return { ok: true, summary: `${name} כבר קיים באנשי הקשר`, agent: "task" };
  const c = await createContact({
    userId: ctx.userId,
    workspaceId: await resolveTargetWorkspaceId(ctx, input.workspace),
    name,
    phone,
    email: input.email ? String(input.email) : null,
    company: input.company ? String(input.company) : null,
    role: input.role ? String(input.role) : null,
    relationshipType: (input.relationshipType as never) ?? "other",
    notes: input.notes ? String(input.notes) : "",
  });
  return { ok: true, summary: `נשמר איש קשר: ${c.name}${phone ? ` (${phone})` : ""}`, target: c.id, agent: "task" };
};

/* ────────────────────────── registry + schemas ────────────────────────── */

export const TOOLS: Record<string, ToolFn> = {
  reach_out_to_customer,
  message_customer,
  find_contact,
  save_contact,
  create_task,
  update_task,
  create_reminder,
  create_goal,
  save_memory,
  request_approval,
  decide_approval,
  draft_email_reply,
  draft_message_reply,
  send_message_now,
  send_image_to_customer,
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
      target: res.target ?? null,
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
    description: "טוען מצב נוכחי לפני החלטה: משימות פתוחות, תזכורות פעילות, אישורים ממתינים, תיבת מייל, הודעות ברשתות, אנשי קשר, תמונות שהבעלים שלחו וממתינות לשליחה (pendingImages).",
    parameters: {
      type: "object",
      properties: { kind: { type: "string", enum: ["overview", "tasks", "reminders", "approvals", "emails", "messages", "contacts", "pendingImages"] } },
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
        workspace: {
          type: "string",
          enum: ["personal", "business"],
          description: "'business' אם המשימה קשורה ללקוח/DALOR (למשל לחזור ללקוח בשם) — אחרת 'personal' (ברירת מחדל).",
        },
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
        workspace: {
          type: "string",
          enum: ["personal", "business"],
          description: "'business' אם התזכורת קשורה ללקוח/DALOR — אחרת 'personal' (ברירת מחדל).",
        },
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
        actionType: {
          type: "string",
          enum: Object.keys(ACTION_CATALOG),
          description: "בחר בדיוק אחד מהערכים המוגדרים — אל תמציא ניסוח חדש (יחיד/רבים וכו'), אחרת האישור ידרוס בהמשך.",
        },
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
    name: "decide_approval",
    description:
      "מאשר/דוחה אישור שכבר קיים וממתין (approvalId מ-get_context kind=approvals). השתמש בזה כשהמשתמשת מאשרת/דוחה בכל ניסוח משלה (\"מאשרת\", \"כן תמחק אותה\", \"סבבה\", \"לא, תעזוב\") — אל תיצרי request_approval נוסף לאותו דבר, ולעולם אל תגידי שאין לך יכולת לבצע אם יש אישור ממתין רלוונטי.",
    parameters: {
      type: "object",
      properties: {
        approvalId: { type: "string" },
        decision: { type: "string", enum: ["approve", "reject"] },
      },
      required: ["approvalId", "decision"],
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
    name: "send_image_to_customer",
    description: "שולח ללקוח תמונה אחת או כמה (עד 50) שהבעלים שלחו לך בוואטסאפ. לתמונה אחת ספציפית שהוזכרה בהודעה — imageMediaId. לכל התמונות שהבעלים הצטברו לאחרונה ('תשלח לו את כל התמונות') — קרא קודם get_context(kind=pendingImages) והעביר את כל ה-mediaId שקיבלת ב-imageMediaIds. messageId מ-get_context kind=messages, בדיוק כמו send_message_now.",
    parameters: {
      type: "object",
      properties: {
        messageId: { type: "string" },
        imageMediaId: { type: "string", description: "לתמונה בודדת" },
        imageMediaIds: { type: "array", items: { type: "string" }, description: "לכמה תמונות בבת אחת — מ-get_context(kind=pendingImages)" },
        caption: { type: "string" },
      },
      required: ["messageId"],
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
  {
    name: "find_contact",
    description:
      "מחפש איש קשר בספר של המשתמשת לפי שם או חלק ממנו — לא צריך את השם המלא המדויק. 'אמא' ימצא את 'אמא היפה שלי', 'בעלי' ימצא את 'בעלי הצדיק', 'חלי' ימצא את 'חלי אגמון'. מחזיר שם + טלפון. השתמשי בזה לפני message_customer/create_reminder כשצריך את המספר של מישהו מהאנשי קשר. אם יש כמה התאמות — הציגי אותן ובקשי הבהרה.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "save_contact",
    description:
      "שומר איש קשר חדש בספר הקשרים של המשתמשת (בסביבה שממנה היא פונה — אישי נשאר פרטי). למשל 'תשמרי שהמספר של רואת החשבון שירן הוא 05...'. קבל name (חובה), phone, email, company, role, relationshipType (client/lead/supplier/partner/family/professional/other), notes.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        company: { type: "string" },
        role: { type: "string" },
        relationshipType: { type: "string" },
        notes: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "message_customer",
    description:
      "שולח הודעה שהמשתמשת ניסחה למספר וואטסאפ של לקוח — למשל 'תשלח ל-050... שהחליפה הגיעה'. עובד גם אם הלקוח לא כתב לבוט לאחרונה: בתוך חלון 24 שעות ההודעה נשלחת כלשונה, ומחוץ לחלון היא נעטפת אוטומטית בתבנית מאושרת (owner_message). קבל phone (חובה), body (תוכן ההודעה, חובה), ו-name (שם הלקוח, אופציונלי). אל תמציאי מספר — אם אין, תשאלי. להשלמת תמונת מצב / תשובה על הודעה קיימת השתמשי ב-send_message_now עם messageId.",
    parameters: {
      type: "object",
      properties: {
        phone: { type: "string" },
        body: { type: "string" },
        name: { type: "string" },
      },
      required: ["phone", "body"],
    },
  },
];
