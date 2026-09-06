import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityLogs, messages } from "@/lib/db/schema";
import { ModelRouter } from "@/lib/ai/model-router";
import { listMemories } from "@/lib/services/memory";
import { createApproval } from "@/lib/services/approvals";
import { logActivity } from "@/lib/services/activity";
import { updateMessage, type Message } from "@/lib/services/messages";
import { executeAction } from "@/lib/services/action-executor";
import { getWorkspace } from "@/lib/services/workspaces";
import { getDayAvailability } from "@/lib/integrations/dalor-barber";
import { parseAppointmentDate, parseAppointmentTime } from "./appointment-helper";
import type { MessageTriage } from "./message-triage";

/** Intents we can actually answer end-to-end today (Stage 2). Appointment
 *  intents move here once the barber connector lands (Stage 5). */
const STAGE_AUTO_INTENTS = new Set(["opening_hours", "location", "barber_pricelist"]);

const INTRO = "היי, כאן ג'ימי — העוזר הדיגיטלי של יאיר 🙂";
const HOLDING = "קיבלתי 🙏 בודק ומחזיר לך תשובה עוד מעט.";

const AUTO_REPLY_WINDOW_MS = 6 * 3600_000;
const MAX_CONSECUTIVE_AUTO = 2;

export interface RespondInput {
  message: typeof messages.$inferSelect;
  triage: MessageTriage;
  ownerUserId: string;
  workspaceId: string | null;
}

export interface RespondResult {
  action: "auto_replied" | "approval_created" | "logged_only";
  detail: string;
  approvalId?: string;
}

/** How many auto-replies we've already sent this author with no owner involvement. */
async function recentAutoReplyCount(channel: Message["channel"], authorHandle: string): Promise<number> {
  const since = new Date(Date.now() - AUTO_REPLY_WINDOW_MS).toISOString();
  const rows = await db
    .select({ id: activityLogs.id })
    .from(activityLogs)
    .where(
      and(
        eq(activityLogs.tool, channel),
        eq(activityLogs.action, `תשובה אוטומטית ל-${authorHandle}`),
        gt(activityLogs.createdAt, since),
      ),
    );
  return rows.length;
}

/** First inbound message ever from this author on this channel? */
async function isFirstContact(channel: Message["channel"], authorHandle: string): Promise<boolean> {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.channel, channel), eq(messages.authorHandle, authorHandle)))
    .orderBy(desc(messages.receivedAt))
    .limit(2);
  return rows.length <= 1;
}

async function factsBlock(userId: string, workspaceId: string | null): Promise<string> {
  const mems = await listMemories(userId, {
    workspaceId: workspaceId ?? undefined,
    types: ["knowledge", "permanent"],
  });
  if (!mems.length) return "";
  return mems.map((m) => `- ${m.subject}: ${m.content}`).join("\n");
}

async function draftReply(
  triage: MessageTriage,
  customerText: string,
  facts: string,
  withIntro: boolean,
): Promise<string> {
  const route = ModelRouter.resolve("writing");
  const prefix = withIntro ? INTRO + "\n" : "";
  if (route.mock || !facts) {
    // no LLM / no facts → holding reply, owner will confirm
    return prefix + HOLDING;
  }
  try {
    const res = await ModelRouter.complete("writing", {
      system:
        "אתה ג'ימי, העוזר הדיגיטלי של DALOR (מספרה + בגדים לגבר). כתוב תשובה קצרה, חמה וישירה בעברית מדוברת בלשון זכר, פנייה בשם אם ידוע, אימוג'י בודד לכל היותר. " +
        "השתמש אך ורק בעובדות שסופקו. אם אין עובדה מדויקת לשאלה — כתוב שתחזור עם תשובה. אסור להמציא מחירים, מלאי או שעות. אל תחתום בשם.",
      messages: [
        {
          role: "user",
          content: `עובדות זמינות:\n${facts}\n\nשאלת הלקוח (${triage.intent}): ${customerText}\n\nנסח/י תשובה:`,
        },
      ],
    });
    const body = res.text.trim();
    return prefix + (body || HOLDING);
  } catch {
    return prefix + HOLDING;
  }
}

/**
 * Decide what to do with a freshly-triaged customer message:
 * auto-reply (whitelisted routine + safe), or raise an approval for יאיר/פז.
 */
function heDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = new Intl.DateTimeFormat("he-IL", { weekday: "long", timeZone: "UTC" }).format(d);
  const [, m, day] = iso.split("-");
  return `${dow} ${Number(day)}/${Number(m)}`;
}

/**
 * Appointment intent handler. Availability answers auto-send (read-only);
 * an actual booking always goes to an approval.
 */
async function appointmentFlow(input: RespondInput, withIntro: boolean): Promise<RespondResult | null> {
  const { message: msg, ownerUserId, workspaceId } = input;
  const prefix = withIntro ? INTRO + "\n" : "";
  const date = parseAppointmentDate(msg.text);
  const time = parseAppointmentTime(msg.text);

  if (!date) {
    const body = prefix + "בכיף אתאם לך תור ✂️ לאיזה יום ושעה נוח לך?";
    return (await sendAuto(input, body, "appointment_ask_day"))
      ? { action: "auto_replied", detail: body }
      : null;
  }

  let day;
  try {
    day = await getDayAvailability(date);
  } catch {
    return null; // fall back to the generic approval path
  }

  if (day.closed && !day.freeSlots.length) {
    const why = day.reason ? ` (${day.reason})` : "";
    const body = prefix + `${heDate(date)} אין תורים פנויים${why}. רוצה שאבדוק יום אחר?`;
    return (await sendAuto(input, body, "appointment_closed"))
      ? { action: "auto_replied", detail: body }
      : null;
  }

  const slotList = day.freeSlots.slice(0, 8).join(" · ");

  // a specific time was asked for
  if (time) {
    if (day.freeSlots.includes(time)) {
      // → booking request: approval
      const approval = await createApproval({
        userId: ownerUserId,
        workspaceId,
        title: `תור ל${msg.authorName ?? "לקוח"} — ${heDate(date)} ${time}`,
        context: `וואטסאפ: "${msg.text}"\nטלפון: ${msg.authorHandle}`,
        actionType: "book_appointment",
        actionPayload: {
          fullName: msg.authorName ?? "לקוח וואטסאפ",
          phone: msg.authorHandle,
          date,
          time,
          notes: "נקבע ע\"י המזכירה הדיגיטלית מוואטסאפ",
          messageId: msg.id,
          replyTo: msg.authorHandle,
        },
        targetSystem: "dalor_barber",
        riskLevel: "yellow",
        reason: "קביעת תור — לאשר לפני שמזמינים במערכת.",
        preview: `לקבוע תור ל-${msg.authorName ?? "לקוח"} (${msg.authorHandle})\n${heDate(date)} בשעה ${time}`,
        proposedBy: "social",
      });
      await updateMessage(ownerUserId, msg.id, { status: "waiting_approval" });
      const body = prefix + `מעולה, ${time} פנוי ✅ אני מעבירה ליאיר לאישור ומעדכנת אותך מיד.`;
      await sendAuto(input, body, "appointment_hold");
      return { action: "approval_created", detail: body, approvalId: approval.id };
    }
    // requested time taken → offer alternatives (safe)
    const body =
      prefix +
      `השעה ${time} כבר תפוסה ל${heDate(date)}. פנוי: ${slotList || "אין"}${day.freeSlots.length > 8 ? " ועוד" : ""}. איזו שעה מתאימה?`;
    return (await sendAuto(input, body, "appointment_slots"))
      ? { action: "auto_replied", detail: body }
      : null;
  }

  // just asking availability → list slots (safe)
  const body = day.freeSlots.length
    ? prefix + `ל${heDate(date)} פנוי: ${slotList}${day.freeSlots.length > 8 ? " ועוד" : ""}. תגיד/י לי איזו שעה ואשריין לך ✂️`
    : prefix + `${heDate(date)} מלא. רוצה שאבדוק יום אחר?`;
  return (await sendAuto(input, body, "appointment_slots"))
    ? { action: "auto_replied", detail: body }
    : null;
}

/** Send an auto-reply and log it (shared by the appointment flow). */
async function sendAuto(input: RespondInput, body: string, tag: string): Promise<boolean> {
  const { message: msg, ownerUserId, workspaceId } = input;
  const r = await executeAction({
    userId: ownerUserId,
    workspaceId,
    actionType: "reply_message",
    payload: { messageId: msg.id, to: msg.authorHandle, text: body, channel: msg.channel },
    targetSystem: msg.channel,
  });
  const delivered = r.ok && r.data?.simulated !== true;
  if (delivered) {
    await updateMessage(ownerUserId, msg.id, { status: "replied", draftReply: body });
    await logActivity({
      userId: ownerUserId,
      workspaceId,
      agent: "social",
      action: `תשובה אוטומטית ל-${msg.authorHandle}`,
      tool: msg.channel,
      target: msg.id,
      riskLevel: "green",
      approvalStatus: "auto",
      result: "success",
      autoExecuted: true,
      metadata: { tag, text: body },
    });
  }
  return delivered;
}

export async function respondToMessage(input: RespondInput): Promise<RespondResult> {
  const { message: msg, triage, ownerUserId, workspaceId } = input;
  const withIntro = await isFirstContact(msg.channel, msg.authorHandle);
  const facts = await factsBlock(ownerUserId, workspaceId);

  // appointment intents get a dedicated flow (real availability + booking approval)
  if (triage.intent === "appointment_availability" || triage.intent === "appointment_confirm") {
    const brake = (await recentAutoReplyCount(msg.channel, msg.authorHandle)) >= MAX_CONSECUTIVE_AUTO;
    if (!brake) {
      try {
        const r = await appointmentFlow(input, withIntro);
        if (r) return r;
      } catch (e) {
        console.error("appointmentFlow failed", e);
      }
    }
  }

  const brakeHit = (await recentAutoReplyCount(msg.channel, msg.authorHandle)) >= MAX_CONSECUTIVE_AUTO;
  const eligible =
    triage.canAutoReply && STAGE_AUTO_INTENTS.has(triage.intent) && !brakeHit;

  const body = await draftReply(triage, msg.text, facts, withIntro);

  if (eligible) {
    const result = await executeAction({
      userId: ownerUserId,
      workspaceId,
      actionType: "reply_message",
      payload: { messageId: msg.id, to: msg.authorHandle, text: body, channel: msg.channel },
      targetSystem: msg.channel,
    });
    if (result.ok) {
      await logActivity({
        userId: ownerUserId,
        workspaceId,
        agent: "social",
        action: `תשובה אוטומטית ל-${msg.authorHandle}`,
        tool: msg.channel,
        target: msg.id,
        riskLevel: "green",
        approvalStatus: "auto",
        result: "success",
        autoExecuted: true,
        metadata: { intent: triage.intent, text: body },
      });
      return { action: "auto_replied", detail: body };
    }
    // fall through to approval on send failure
  }

  // needs a person: raise an approval with a suggested draft
  const ws = workspaceId ? await getWorkspace(ownerUserId, workspaceId) : null;
  const reasonByIntent: Record<string, string> = {
    clothing_availability:
      "שאלה על זמינות/מידה של בגד — הקטלוג לא מעודכן, אסור לענות 'אין לנו'. יאיר/פז בודקים מול החנות.",
    price_or_discount: "שאלה על מחיר/הנחה — דורש אישור לפני מסירת מחיר.",
    complaint: "תלונה / סנטימנט שלילי — תמיד עובר אישור.",
    appointment_availability: "בקשת תור — לאשר לפני קביעה (יחובר ל-API התורים בשלב הבא).",
    appointment_confirm: "אישור תור קיים — לאמת מול היומן.",
    appointment_change: "בקשה לבטל/להזיז תור.",
    order_status: "שאלה על סטטוס הזמנה.",
    other: "כוונה לא ודאית — עדיף שאדם יראה.",
  };
  const approval = await createApproval({
    userId: ownerUserId,
    workspaceId,
    title: `תשובה ל${msg.authorName ? ` ${msg.authorName}` : "לקוח"} (${msg.channel})`,
    context: `הודעה נכנסת: "${msg.text}"${ws ? ` · ${ws.name}` : ""}`,
    actionType: "reply_message",
    actionPayload: { messageId: msg.id, to: msg.authorHandle, text: body, channel: msg.channel },
    targetSystem: msg.channel,
    riskLevel: "yellow",
    reason: reasonByIntent[triage.intent] ?? "הודעת לקוח — נדרש אישור לפני שליחה.",
    preview: body,
    proposedBy: "social",
  });
  await updateMessage(ownerUserId, msg.id, { status: "waiting_approval", draftReply: body });
  if (brakeHit && triage.canAutoReply) {
    await logActivity({
      userId: ownerUserId,
      workspaceId,
      agent: "social",
      action: `בלם בטיחות: כבר ${MAX_CONSECUTIVE_AUTO} תשובות אוטומטיות ל-${msg.authorHandle} — עובר לאישור`,
      tool: msg.channel,
      target: msg.id,
      result: "info",
    });
  }
  return { action: "approval_created", detail: body, approvalId: approval.id };
}
