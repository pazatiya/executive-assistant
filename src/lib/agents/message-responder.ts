import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityLogs, messages } from "@/lib/db/schema";
import { ModelRouter } from "@/lib/ai/model-router";
import { listMemories } from "@/lib/services/memory";
import { createApproval } from "@/lib/services/approvals";
import { logActivity } from "@/lib/services/activity";
import { updateMessage, MANUAL_REPLY_TOOL, type Message } from "@/lib/services/messages";
import { executeAction } from "@/lib/services/action-executor";
import { traceMessage } from "@/lib/services/message-trace";
import { getAssistantMode } from "@/lib/services/workspaces";
import { notifyOwnersOf } from "@/lib/services/notifications";
import { getDayAvailability, findUpcomingAppointmentsByPhone } from "@/lib/integrations/dalor-barber";
import { parseAppointmentDate, parseAppointmentTime } from "./appointment-helper";
import type { MessageTriage } from "./message-triage";

/** Routine intents the assistant may answer automatically — but only in `active` mode. */
const AUTO_SEND_INTENTS = new Set([
  "greeting",
  "opening_hours",
  "location",
  "barber_pricelist",
  "appointment_availability",
  "appointment_confirm",
]);

const HOLDING = "קיבלתי 🙏 בודק ומחזיר לך תשובה עוד מעט.";
const WELCOME =
  "היי 👋 כאן ג'ימי, נציג השירות של DALOR.\n" +
  "צריך לקבוע תור, לבדוק מחיר, שעות פתיחה, כתובת או לשאול על בגדים? אני כאן בשבילך.\n" +
  "איך אפשר לעזור לך?\n" +
  'אם תרצה לדבר עם נציג אנושי, פשוט כתוב "נציג".';
// customer wants a human — we ack and flag it, never keep chatting
const HANDOFF = "קיבלתי 🙏 העברתי את הפנייה שלך לנציג שירות, נחזור אליך בקרוב.";
// clothing / product / order questions — iron rule, always check with the store
const STORE_HOLDING = "בודק מול החנות מה יש ומחזיר לך תשובה בהקדם 👕";

const AUTO_REPLY_WINDOW_MS = 6 * 3600_000;
// a normal customer asks a few things in a row (hours, then address, then price) —
// allow that, but stop auto-answering if it turns into a long unattended thread.
const MAX_CONSECUTIVE_AUTO = 5;

export interface RespondInput {
  message: typeof messages.$inferSelect;
  triage: MessageTriage;
  ownerUserId: string;
  workspaceId: string | null;
  /** Message was a voice note (machine-transcribed) — never auto-send, always leave a draft for the owners. */
  viaVoice?: boolean;
}

export interface RespondResult {
  action: "auto_replied" | "drafted" | "approval_created" | "silent";
  detail: string;
  approvalId?: string;
}

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

// Owner-issued sends (send_message_now / send_image_to_customer /
// reach_out_to_customer — see tools.ts) log their target phone on the
// activity row. If the owner personally sent this customer something
// recently, they're already in the conversation by hand — the assistant must
// never auto-send (or auto-ack) over them; it still drafts and notifies as
// usual, it just never presses send itself. Window slides forward with every
// message the owner sends, so an active back-and-forth stays covered — the
// owner asked specifically for 3 hours (a real negotiation with a customer
// can easily have 60-90 minute gaps between replies while they think it
// over, and 1 hour was cutting that off mid-conversation).
const OWNER_HANDLING_WINDOW_MS = 3 * 60 * 60_000;
const OWNER_SEND_TOOLS = ["send_message_now", "send_image_to_customer", "reach_out_to_customer", "message_customer", MANUAL_REPLY_TOOL];
async function ownerHandledRecently(authorHandle: string): Promise<boolean> {
  const since = new Date(Date.now() - OWNER_HANDLING_WINDOW_MS).toISOString();
  const rows = await db
    .select({ tool: activityLogs.tool })
    .from(activityLogs)
    .where(and(eq(activityLogs.target, authorHandle), gt(activityLogs.createdAt, since)))
    .limit(20);
  return rows.some((r) => OWNER_SEND_TOOLS.includes(r.tool ?? ""));
}

const INTRO_GAP_MS = 12 * 3600_000;

/**
 * Whether to (re-)introduce "כאן ג'ימי מ-DALOR" — not just literally their
 * first-ever message, but also true again if it's been 12+ hours since they
 * last wrote in. A customer who messaged two days ago and comes back today
 * is starting a fresh conversation in every way that matters; skipping the
 * intro because a row exists from days ago read as never having said hello.
 */
async function isFirstContact(channel: Message["channel"], authorHandle: string): Promise<boolean> {
  const rows = await db
    .select({ receivedAt: messages.receivedAt })
    .from(messages)
    .where(and(eq(messages.channel, channel), eq(messages.authorHandle, authorHandle)))
    .orderBy(desc(messages.receivedAt))
    .limit(2);
  // rows[0] is the message just received (already inserted by the time this
  // runs); rows[1], if any, is the one before it — the real "last contact".
  const previous = rows[1];
  if (!previous) return true;
  return Date.now() - new Date(previous.receivedAt).getTime() > INTRO_GAP_MS;
}

async function factsBlock(userId: string, workspaceId: string | null): Promise<string> {
  const mems = await listMemories(userId, {
    workspaceId: workspaceId ?? undefined,
    types: ["knowledge", "permanent"],
  });
  if (!mems.length) return "";
  return mems.map((m) => `- ${m.subject}: ${m.content}`).join("\n");
}

function heDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = new Intl.DateTimeFormat("he-IL", { weekday: "long", timeZone: "UTC" }).format(d);
  const [, m, day] = iso.split("-");
  return `${dow} ${Number(day)}/${Number(m)}`;
}

/** Compose the suggested reply for a triaged message. Never sends. */
async function composeDraft(
  triage: MessageTriage,
  msg: RespondInput["message"],
  facts: string,
  withIntro: boolean,
): Promise<{
  text: string;
  grounded: boolean;
  bookingApprovalPayload?: Record<string, unknown>;
  cancelApprovalPayload?: Record<string, unknown>;
  /** Why the draft is only a holding reply (shown to the owners as the reason). */
  note?: string;
}> {
  const prefix = withIntro ? WELCOME + "\n\n" : "";

  // ── bare greeting → a warm welcome ───────────────────────────────
  if (triage.intent === "greeting") {
    return {
      text: withIntro ? WELCOME : "היי 🙂 איך אפשר לעזור? תור, מחיר, שעות, כתובת או בגדים.",
      grounded: true,
    };
  }

  // ── wants a human → ack + hand off ──────────────────────────────
  if (triage.intent === "wants_human") {
    return { text: prefix + HANDOFF, grounded: true };
  }

  // ── clothing / product / order → iron rule, check with the store ─
  if (
    triage.intent === "clothing_availability" ||
    triage.intent === "clothing_order" ||
    triage.intent === "order_status"
  ) {
    return { text: prefix + STORE_HOLDING, grounded: true };
  }

  // ── appointment intents: use live availability ────────────────────
  if (triage.intent === "appointment_availability" || triage.intent === "appointment_confirm") {
    const date = parseAppointmentDate(msg.text);
    const time = parseAppointmentTime(msg.text);
    if (!date) return { text: prefix + "בכיף אתאם לך תור ✂️ לאיזה יום ושעה נוח לך?", grounded: true };
    let day;
    try {
      day = await getDayAvailability(date);
    } catch {
      return { text: prefix + HOLDING, grounded: false };
    }
    if (day.closed && !day.freeSlots.length) {
      const why = day.reason ? ` (${day.reason})` : "";
      return { text: prefix + `${heDate(date)} אין תורים פנויים${why}. רוצה שאבדוק יום אחר?`, grounded: true };
    }
    const slotList = day.freeSlots.slice(0, 8).join(" · ");
    if (time && day.freeSlots.includes(time)) {
      return {
        text: prefix + `${time} פנוי ל${heDate(date)} ✅ מעביר לאישור של יאיר וחוזר אלייך לעדכן.`,
        grounded: true,
        bookingApprovalPayload: {
          fullName: msg.authorName ?? "לקוח וואטסאפ",
          phone: msg.authorHandle,
          date,
          time,
          notes: "נקבע ע\"י המזכירה הדיגיטלית מוואטסאפ",
          messageId: msg.id,
          replyTo: msg.authorHandle,
        },
      };
    }
    if (time) {
      return {
        text: prefix + `${time} כבר תפוס ל${heDate(date)}. פנוי: ${slotList || "אין"}${day.freeSlots.length > 8 ? " ועוד" : ""}. איזו שעה מתאימה?`,
        grounded: true,
      };
    }
    return {
      text: day.freeSlots.length
        ? prefix + `ל${heDate(date)} פנוי: ${slotList}${day.freeSlots.length > 8 ? " ועוד" : ""}. תגיד לי איזו שעה ואשריין ✂️`
        : prefix + `${heDate(date)} מלא. רוצה שאבדוק יום אחר?`,
      grounded: true,
    };
  }

  // ── cancel an existing appointment: find it by phone → approval ───
  if (triage.intent === "appointment_change" && /לבטל|תבטל|ביטול|cancel/i.test(msg.text)) {
    let upcoming;
    try {
      upcoming = await findUpcomingAppointmentsByPhone(msg.authorHandle);
    } catch (e) {
      return {
        text: prefix + HOLDING,
        grounded: false,
        note: `לא הצלחתי לבדוק את התורים של הלקוח: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    if (upcoming.length === 1) {
      const a = upcoming[0];
      return {
        text: prefix + `מבטל לך את התור של ${heDate(a.date)} בשעה ${a.time} — מעביר לאישור של יאיר וחוזר אלייך לעדכן.`,
        grounded: true,
        cancelApprovalPayload: {
          appointmentId: a.id,
          fullName: a.fullName,
          phone: msg.authorHandle,
          date: a.date,
          time: a.time,
          messageId: msg.id,
          replyTo: msg.authorHandle,
        },
      };
    }
    if (upcoming.length > 1) {
      const list = upcoming.slice(0, 5).map((a) => `${heDate(a.date)} ${a.time}`).join(" · ");
      return { text: prefix + `יש לך כמה תורים: ${list}. איזה מהם לבטל?`, grounded: true };
    }
    return { text: prefix + "לא מצאתי תור עתידי על המספר הזה. על איזה תור מדובר?", grounded: false };
  }

  // ── routine facts (hours / location / pricelist) via LLM ──────────
  const route = ModelRouter.resolve("writing");
  if (route.mock || !facts) return { text: prefix + HOLDING, grounded: false };
  try {
    const res = await ModelRouter.complete("writing", {
      system:
        "אתה ג'ימי, נציג השירות של DALOR (מספרה + בגדים לגבר). תשובה קצרה, חמה וישירה בעברית מדוברת בלשון זכר, אימוג'י בודד לכל היותר. " +
        "הטון: אנושי וחם, אבל מקצועי מאוד. בלי בדיחות, בלי סלנג חברי, אל תדבר אל הלקוח כאילו אתה חבר שלו — אתה נציג שירות של העסק. " +
        "השתמש אך ורק בעובדות שסופקו. אם אין עובדה מדויקת — כתוב שתחזור עם תשובה. אסור להמציא מחירים, מלאי או שעות. אל תחתום בשם. " +
        (withIntro
          ? "פתחנו כבר במשפט היכרות — אל תוסיף ברכה, אל תפתח ב'היי' או 'שלום', עבור ישר לתשובה."
          : "אפשר לפתוח ב'היי' קצר."),
      messages: [
        { role: "user", content: `עובדות:\n${facts}\n\nשאלת הלקוח (${triage.intent}): ${msg.text}\n\nנסח תשובה:` },
      ],
    });
    let body = res.text.trim();
    // belt-and-suspenders: never double-greet after the intro line
    if (withIntro) body = body.replace(/^(היי|שלום|אהלן|הי)[,!\s]+/u, "");
    // heuristic: is the answer actually grounded in a fact, or a "I'll check"?
    const grounded =
      AUTO_SEND_INTENTS.has(triage.intent) && body.length > 0 && !/אחזור|אבדוק|אני בודק/.test(body);
    return { text: prefix + (body || HOLDING), grounded };
  } catch {
    return { text: prefix + HOLDING, grounded: false };
  }
}

/**
 * Handle a freshly-triaged customer message.
 * draft_only mode: never sends — always a draft the owner reviews in the app.
 * active mode: whitelisted routine answers send automatically, rest still draft.
 */
export async function respondToMessage(input: RespondInput): Promise<RespondResult> {
  const { message: msg, triage, ownerUserId, workspaceId } = input;
  const [withIntro, facts, mode, autoCount, ownerHandling] = await Promise.all([
    isFirstContact(msg.channel, msg.authorHandle),
    factsBlock(ownerUserId, workspaceId),
    getAssistantMode(workspaceId),
    recentAutoReplyCount(msg.channel, msg.authorHandle),
    ownerHandledRecently(msg.authorHandle),
  ]);

  const { text: draft, grounded, bookingApprovalPayload, cancelApprovalPayload, note } = await composeDraft(triage, msg, facts, withIntro);

  const who = msg.authorName || msg.authorHandle;
  // always carries the phone, even when we also know a name — so a push
  // notification alone is enough to call/text back, no need to open the app.
  const whoWithPhone = msg.authorName ? `${msg.authorName} (${msg.authorHandle})` : msg.authorHandle;
  const isComplaint = triage.classification === "complaint" || triage.sentiment === "negative";

  // booking with a confirmed free slot → real action → approval (app)
  let approvalId: string | undefined;
  if (bookingApprovalPayload) {
    const a = await createApproval({
      userId: ownerUserId,
      workspaceId,
      title: `תור ל${who} — ${heDate(String(bookingApprovalPayload.date))} ${bookingApprovalPayload.time}`,
      context: `וואטסאפ: "${msg.text}"`,
      actionType: "book_appointment",
      actionPayload: bookingApprovalPayload,
      targetSystem: "dalor_barber",
      riskLevel: "yellow",
      reason: "בקשת תור — לאשר לפני קביעה.",
      preview: `לקבוע תור ל-${who} (${msg.authorHandle}) — ${heDate(String(bookingApprovalPayload.date))} ${bookingApprovalPayload.time}`,
      proposedBy: "social",
    });
    approvalId = a.id;
  }

  if (cancelApprovalPayload) {
    const a = await createApproval({
      userId: ownerUserId,
      workspaceId,
      title: `ביטול תור — ${who}, ${heDate(String(cancelApprovalPayload.date))} ${cancelApprovalPayload.time}`,
      context: `וואטסאפ: "${msg.text}"`,
      actionType: "cancel_appointment",
      actionPayload: cancelApprovalPayload,
      targetSystem: "dalor_barber",
      riskLevel: "yellow",
      reason: "הלקוח ביקש לבטל תור — לאשר לפני ביטול.",
      preview: `לבטל את התור של ${who} (${msg.authorHandle}) — ${heDate(String(cancelApprovalPayload.date))} ${cancelApprovalPayload.time}`,
      proposedBy: "social",
    });
    approvalId = a.id;
  }

  const trace = (sent: boolean, text?: string | null, reason?: string | null) =>
    traceMessage({ userId: ownerUserId, workspaceId, messageId: msg.id, sent, text, reason });

  // Booking / cancel request → the customer gets an immediate, real "passing it to
  // Yair for approval, will update you" (regardless of draft mode); the actual
  // confirmation goes out only after the approval is executed.
  if (approvalId) {
    let why: string | null = null;
    if (input.viaVoice) why = "הודעה קולית (תמלול אוטומטי) — לא שולחים אוטומטית";
    else if (ownerHandling) why = "אחד מכם ענה ללקוח לאחרונה — לא נשלח אוטומטית";
    else if (autoCount >= MAX_CONSECUTIVE_AUTO) why = "הגענו למגבלת תשובות אוטומטיות רצופות ללקוח";
    let ackSent = false;
    if (!why) {
      const r = await executeAction({
        userId: ownerUserId,
        workspaceId,
        actionType: "reply_message",
        payload: { messageId: msg.id, to: msg.authorHandle, text: draft, channel: msg.channel },
        targetSystem: msg.channel,
      });
      if (r.ok && r.data?.simulated !== true) ackSent = true;
      else why = r.error ?? (r.data?.simulated ? "WhatsApp לא מחובר (מצב הדמיה)" : "השליחה נכשלה");
    }
    await trace(ackSent, draft, why);
    await updateMessage(ownerUserId, msg.id, { status: "drafted", draftReply: ackSent ? null : draft, priority: "high" });
    await notifyOwnersOf(workspaceId, {
      fallbackUserId: ownerUserId,
      kind: "proactive",
      title: `${cancelApprovalPayload ? "ביטול תור" : "בקשת תור"} מ-${whoWithPhone} — ממתין לאישור`,
      body: `"${msg.text}"\n\n${ackSent ? "ללקוח נשלח: מעביר לאישור וחוזר עם עדכון." : `ללקוח לא נשלח כלום (${why}).`}`,
      href: "/approvals",
      priority: "high",
    }).catch(() => {});
    return { action: "approval_created", detail: draft, approvalId };
  }

  // Why a plain reply is NOT auto-sent (shown to the owners in the inbox).
  const whyNotAutoSent = (): string => {
    if (input.viaVoice) return "הודעה קולית (תמלול אוטומטי) — לא שולחים אוטומטית";
    if (mode !== "active") return "מצב טיוטות — שום דבר לא נשלח אוטומטית";
    if (ownerHandling) return "אחד מכם ענה ללקוח לאחרונה — לא נשלח אוטומטית";
    if (autoCount >= MAX_CONSECUTIVE_AUTO) return "הגענו למגבלת תשובות אוטומטיות רצופות ללקוח";
    if (isComplaint) return "תלונה — דורש מענה אנושי";
    if (!AUTO_SEND_INTENTS.has(triage.intent)) return "נושא שדורש החלטה אנושית";
    if (!grounded) return "התשובה לא מבוססת על עובדה ודאית";
    return "לא נשלח";
  };

  // Intents where the assistant sends a fixed acknowledgment automatically
  // (in active mode) but ALWAYS alerts the owners to pick the thread up:
  // "talk to a human", and anything about clothing / a product / an order.
  const ACK_AND_ALERT = new Set(["wants_human", "clothing_availability", "clothing_order", "order_status"]);
  if (ACK_AND_ALERT.has(triage.intent)) {
    let acked = false;
    let ackFailure: string | null = null;
    if (mode === "active" && !input.viaVoice && autoCount < MAX_CONSECUTIVE_AUTO && !ownerHandling) {
      const r = await executeAction({
        userId: ownerUserId,
        workspaceId,
        actionType: "reply_message",
        payload: { messageId: msg.id, to: msg.authorHandle, text: draft, channel: msg.channel },
        targetSystem: msg.channel,
      });
      acked = r.ok && r.data?.simulated !== true;
      if (!acked) ackFailure = r.error ?? "השליחה נכשלה";
    }
    await trace(acked, draft, acked ? null : ackFailure ?? whyNotAutoSent());
    await updateMessage(ownerUserId, msg.id, {
      status: acked ? "replied" : "drafted",
      draftReply: draft,
      priority: "high",
    });
    // This path (wants_human / clothing / order questions) never wrote to the
    // activity log at all — the only trace was the in-app notification, which
    // doesn't show what was actually sent (or that nothing was, if drafted).
    await logActivity({
      userId: ownerUserId,
      workspaceId,
      agent: "social",
      action: acked
        ? `תשובה אוטומטית ל-${msg.authorHandle}: "${draft.slice(0, 100)}"`
        : `טיוטה הוכנה ל-${msg.authorHandle} (ממתינה לשליחה ידנית): "${draft.slice(0, 100)}"`,
      tool: msg.channel,
      target: msg.id,
      riskLevel: "green",
      approvalStatus: acked ? "auto" : "not_required",
      result: "success",
      autoExecuted: acked,
      metadata: { intent: triage.intent },
    });
    const isHuman = triage.intent === "wants_human";
    await notifyOwnersOf(workspaceId, {
      fallbackUserId: ownerUserId,
      kind: "proactive",
      title: isHuman ? `🙋 ${whoWithPhone} מבקש/ת לדבר עם נציג` : `👕 ${whoWithPhone} — שאלת בגדים/הזמנה`,
      body: `"${msg.text}"\n\n${isHuman ? "היכנסו ל-הודעות וענו." : "צריך לבדוק מול החנות ולחזור ללקוח."}`,
      href: "/messages",
      priority: "high",
    }).catch(() => {});
    return { action: acked ? "auto_replied" : "drafted", detail: draft };
  }

  const canAutoSend =
    mode === "active" &&
    !input.viaVoice &&
    grounded &&
    !isComplaint &&
    AUTO_SEND_INTENTS.has(triage.intent) &&
    autoCount < MAX_CONSECUTIVE_AUTO &&
    !bookingApprovalPayload &&
    !cancelApprovalPayload &&
    !ownerHandling;

  let autoSendFailure: string | null = null;
  if (canAutoSend) {
    const r = await executeAction({
      userId: ownerUserId,
      workspaceId,
      actionType: "reply_message",
      payload: { messageId: msg.id, to: msg.authorHandle, text: draft, channel: msg.channel },
      targetSystem: msg.channel,
    });
    if (r.ok && r.data?.simulated !== true) {
      await trace(true, draft);
      await updateMessage(ownerUserId, msg.id, { status: "replied", draftReply: draft });
      await logActivity({
        userId: ownerUserId,
        workspaceId,
        agent: "social",
        action: `תשובה אוטומטית ל-${msg.authorHandle}: "${draft.slice(0, 100)}"`,
        tool: msg.channel,
        target: msg.id,
        riskLevel: "green",
        approvalStatus: "auto",
        result: "success",
        autoExecuted: true,
        metadata: { intent: triage.intent, text: draft },
      });
      return { action: "auto_replied", detail: draft };
    }
    // send failed → fall through to draft
    autoSendFailure = r.error ?? "השליחה נכשלה";
  }

  // draft-only: park the suggested reply, notify the owners
  await trace(false, draft, autoSendFailure ? `שליחה אוטומטית נכשלה: ${autoSendFailure}` : note ?? whyNotAutoSent());
  await updateMessage(ownerUserId, msg.id, { status: "drafted", draftReply: draft });
  await notifyOwnersOf(workspaceId, {
    fallbackUserId: ownerUserId,
    kind: isComplaint ? "proactive" : "info",
    title: isComplaint ? `⚠️ תלונה מ-${whoWithPhone}` : `הודעה מ-${whoWithPhone}`,
    body: msg.text.slice(0, 140),
    href: "/messages",
    priority: isComplaint ? "urgent" : triage.priority === "urgent" ? "high" : "normal",
  });

  return {
    action: bookingApprovalPayload || cancelApprovalPayload ? "approval_created" : "drafted",
    detail: draft,
    approvalId,
  };
}
