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
import { WELCOME, PRODUCTS_BUTTON, APPT_BUTTON, APPT_BUTTON_REPLY, PRODUCTS_BUTTON_REPLY, buttonKey } from "@/lib/integrations/welcome";
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
  "general_info",
]);

const HOLDING = "קיבלתי 🙏 בודק ומחזיר לך תשובה עוד מעט.";
// customer wants a human — we ack and flag it, never keep chatting
// complaint: never argue or improvise — just acknowledge and say it's being handled
// voice note we couldn't transcribe — don't pretend we understood it
const VOICE_FAILED_ACK = "קיבלנו את ההודעה הקולית, אבל לא הצלחנו לשמוע אותה בבירור 🙏 אפשר לכתוב לנו במה מדובר?";
const COMPLAINT_ACK =
  "מצטערים לשמוע 🙏\n\n" +
  "העברנו את פנייתכם לטיפול הצוות, ונחזור אליכם בהקדם האפשרי.";
const HANDOFF =
  "בשמחה!\n\n" +
  "אני מעביר את פנייתכם לנציג מצוות DALOR, שימשיך את הטיפול בבקשתכם.\n\n" +
  "נציג יחזור אליכם בהקדם האפשרי.\n\n" +
  "תודה על הסבלנות! 🖤";
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

const STATIC_FACTS = [
  "- תשלום: אפשר לשלם באשראי, בביט ובפייבוקס, דרך בוט ההזמנות של DALOR.",
  "- משלוחים: עלות משלוח 35 ש\"ח, זמן אספקה עד 5 ימי עסקים.",
  "- החלפות והחזרות: עד שבועיים מהקנייה, ורק אם הפריט לא נלבש. הלבשה תחתונה לא ניתנת להחלפה.",
  "- חניה ונגישות: יש חניה ונגישות ליד העסק.",
  "- בוט ההזמנות של DALOR (להזמנות ותשלום): וואטסאפ 050-4997233.",
  "- אתר DALOR: https://dalor.co.il",
  "- אינסטגרם DALOR: https://www.instagram.com/dalor_paz_yair",
  "- מידות / טבלת מידות: אין לנו מידע מוכן — אומרים שבודקים מול החנות וחוזרים ללקוח.",
  "- מדיניות ביטול או איחור בתור: אין לנו מידע מוכן — אומרים שבודקים מול יאיר וחוזרים ללקוח.",
];

async function factsBlock(userId: string, workspaceId: string | null): Promise<string> {
  const mems = await listMemories(userId, {
    workspaceId: workspaceId ?? undefined,
    types: ["knowledge", "permanent"],
  });
  const lines = mems.map((m) => `- ${m.subject}: ${m.content}`);
  // fixed business facts (owner-confirmed) — always available, on top of the /memory page
  return [...STATIC_FACTS, ...lines].join("\n");
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
    if (buttonKey(msg.text) === APPT_BUTTON) return { text: APPT_BUTTON_REPLY, grounded: true };
    if (buttonKey(msg.text) === PRODUCTS_BUTTON) return { text: PRODUCTS_BUTTON_REPLY, grounded: true };
    return {
      text: withIntro ? WELCOME : "היי 🙂 איך אפשר לעזור? תור, מחיר, שעות, כתובת או בגדים.",
      grounded: true,
    };
  }

  // ── wants a human → ack + hand off ──────────────────────────────
  if (triage.intent === "wants_human") {
    return { text: prefix + HANDOFF, grounded: true };
  }

  // ── complaint → short acknowledgement, handled by a human ────────
  if (triage.intent === "complaint" || triage.classification === "complaint" || triage.sentiment === "negative") {
    return { text: prefix + COMPLAINT_ACK, grounded: true };
  }

  // ── price / discount on an item → the catalogue isn't reliable, check with the store
  if (triage.intent === "price_or_discount") {
    return { text: prefix + STORE_HOLDING, grounded: true };
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
    if (time && day.freeSlots.includes(time) && msg.channel !== "whatsapp") {
      // Instagram/Facebook give us no phone number, and the booking system identifies (and
      // reminds) a customer by phone — so never book from here. Say it's free and ask for the details.
      return {
        text: prefix + `${time} פנוי ל${heDate(date)} ✅ כדי לסגור את התור אני צריך שם מלא ומספר טלפון — כתוב לי אותם ואעביר לאישור של יאיר.`,
        grounded: true,
      };
    }
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
  if (triage.intent === "appointment_change" && /לבטל|תבטל|ביטול|cancel/i.test(msg.text) && msg.channel !== "whatsapp") {
    // appointments are looked up by phone number, which Instagram/Facebook don't give us
    return { text: prefix + "כדי לבטל תור אני צריך לזהות אותך לפי מספר הטלפון שבו קבעת — כתוב לי אותו ואעביר לטיפול של יאיר.", grounded: true };
  }
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
 * One short courtesy line for a message that needs no action ("thanks", "I'll
 * come tomorrow"). Returns null when no reply is warranted (a bare emoji / "ok"),
 * so two polite messages never ping-pong forever.
 */
async function courtesyReply(text: string): Promise<string | null> {
  const FALLBACK = /תודה|תודה רבה|thanks|thank you/i.test(text) ? "בשמחה 🙏" : null;
  const route = ModelRouter.resolve("writing");
  if (route.mock) return FALLBACK;
  try {
    const res = await ModelRouter.complete("writing", {
      system:
        "אתה ג'ימי, נציג השירות של DALOR (מספרה + בגדים לגבר). הלקוח שלח הודעת מידע/נימוס שלא דורשת פעולה. " +
        "כתוב תגובה אחת קצרה מאוד בעברית (עד 8 מילים), בלשון רבים/ניטרלית, מותאמת להקשר: " +
        "על תודה — 'בשמחה'; על 'אגיע מחר/בדרך' — משהו כמו 'מעולה, נשמח לראותכם'. " +
        "בלי להבטיח כלום, בלי עובדות חדשות, בלי שאלות, אימוג'י אחד לכל היותר. " +
        "אם ההודעה היא רק אימוג'י, 'אוקיי', 'סבבה', 'קיבלתי' או 'ביי' — החזר בדיוק: SKIP",
      messages: [{ role: "user", content: `הודעת הלקוח: ${text}` }],
    });
    const out = res.text.trim();
    if (!out || /^SKIP$/i.test(out) || out.length > 80) return null;
    return out;
  } catch {
    return FALLBACK;
  }
}

/**
 * Text of the customer's previous inbound message (if recent). Lets a follow-up
 * like "tomorrow at 17:00" be understood in the context of the welcome button
 * they tapped just before — the triage only ever sees one message at a time.
 */
async function previousInboundText(msg: Message): Promise<string | null> {
  const since = new Date(Date.now() - AUTO_REPLY_WINDOW_MS).toISOString();
  const rows = await db
    .select({ id: messages.id, text: messages.text })
    .from(messages)
    .where(
      and(
        eq(messages.channel, msg.channel),
        eq(messages.authorHandle, msg.authorHandle),
        eq(messages.source, "live"),
        gt(messages.receivedAt, since),
      ),
    )
    .orderBy(desc(messages.receivedAt))
    .limit(5);
  return rows.find((r) => r.id !== msg.id)?.text?.trim() ?? null;
}

/**
 * Handle a freshly-triaged customer message.
 * draft_only mode: never sends — always a draft the owner reviews in the app.
 * active mode: whitelisted routine answers send automatically, rest still draft.
 */
export async function respondToMessage(input: RespondInput): Promise<RespondResult> {
  const { message: msg, ownerUserId, workspaceId } = input;
  // Tapping "מוצרים והזמנות" on the welcome buttons isn't a real order question yet —
  // answer with a follow-up prompt, no store alert.
  const isButton = buttonKey(msg.text) === PRODUCTS_BUTTON || buttonKey(msg.text) === APPT_BUTTON;
  let triage: MessageTriage = isButton
    ? { ...input.triage, intent: "greeting", classification: "other", needsReply: false, canAutoReply: true }
    : input.triage;
  // Conversation continues after a welcome button: keep the context of what they picked.
  if (!isButton && (triage.intent === "other" || triage.intent === "greeting")) {
    const prev = await previousInboundText(msg);
    if (buttonKey(prev) === APPT_BUTTON) {
      triage = { ...triage, intent: "appointment_availability", classification: "lead", needsReply: true, canAutoReply: true };
    } else if (buttonKey(prev) === PRODUCTS_BUTTON) {
      triage = { ...triage, intent: "clothing_availability", classification: "lead", needsReply: true, canAutoReply: false };
    }
  }
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
      // the proactive alert below already tells the owners (and what the customer was sent) — one ping, not two
      notifyOwners: false,
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
      // the proactive alert below already tells the owners (and what the customer was sent) — one ping, not two
      notifyOwners: false,
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
    if (ownerHandling) why = "אחד מכם ענה ללקוח לאחרונה — לא נשלח אוטומטית";
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
      else why = r.error ?? (r.data?.simulated ? "הערוץ לא מחובר (מצב הדמיה)" : "השליחה נכשלה");
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
    const isHuman = triage.intent === "wants_human";
    // "Talk to a human": the customer is told a representative will follow up ONLY
    // after the hand-off really happened — i.e. the owners were notified (app row +
    // push + WhatsApp). If that fails, nothing is promised to the customer.
    let handedOff = !isHuman;
    if (isHuman) {
      try {
        await notifyOwnersOf(workspaceId, {
          fallbackUserId: ownerUserId,
          kind: "proactive",
          title: `🙋 ${whoWithPhone} מבקש/ת לדבר עם נציג`,
          body: `"${msg.text}"\n\nהיכנסו ל-הודעות וענו.`,
          href: "/messages",
          priority: "urgent",
        });
        handedOff = true;
      } catch (e) {
        console.error("[handoff] owner notification failed — not promising a rep to the customer", e);
        ackFailure = "ההעברה לנציג נכשלה — לא נשלחה הבטחה ללקוח";
      }
    }
    if (handedOff && mode === "active" && autoCount < MAX_CONSECUTIVE_AUTO && !ownerHandling) {
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
    if (!isHuman) await notifyOwnersOf(workspaceId, {
      fallbackUserId: ownerUserId,
      kind: "proactive",
      title: isHuman ? `🙋 ${whoWithPhone} מבקש/ת לדבר עם נציג` : `👕 ${whoWithPhone} — שאלת בגדים/הזמנה`,
      body: `"${msg.text}"\n\n${isHuman ? "היכנסו ל-הודעות וענו." : "צריך לבדוק מול החנות ולחזור ללקוח."}`,
      href: "/messages",
      priority: "high",
    }).catch(() => {});
    return { action: acked ? "auto_replied" : "drafted", detail: draft };
  }

  // "Thanks" / "I'll come tomorrow" / "ok": no alert, no task — but a short,
  // context-aware courtesy reply instead of leaving the customer hanging.
  if (
    triage.needsReply === false &&
    !isComplaint &&
    triage.intent !== "complaint" &&
    mode === "active" &&
    autoCount < MAX_CONSECUTIVE_AUTO &&
    !ownerHandling &&
    !bookingApprovalPayload &&
    !cancelApprovalPayload
  ) {
    const courtesy = await courtesyReply(msg.text);
    if (courtesy) {
      const r = await executeAction({
        userId: ownerUserId,
        workspaceId,
        actionType: "reply_message",
        payload: { messageId: msg.id, to: msg.authorHandle, text: courtesy, channel: msg.channel },
        targetSystem: msg.channel,
      });
      if (r.ok && r.data?.simulated !== true) {
        await trace(true, courtesy);
        await updateMessage(ownerUserId, msg.id, { status: "replied", draftReply: courtesy });
        await logActivity({
          userId: ownerUserId,
          workspaceId,
          agent: "social",
          action: `תשובה אוטומטית ל-${msg.authorHandle}: "${courtesy.slice(0, 100)}"`,
          tool: msg.channel,
          target: msg.id,
          riskLevel: "green",
          approvalStatus: "auto",
          result: "success",
          autoExecuted: true,
          metadata: { intent: triage.intent, courtesy: true },
        });
        return { action: "auto_replied", detail: courtesy };
      }
    }
  }

  // Complaints, price/discount questions and anything Jimmy doesn't understand:
  // the customer must never be left in silence. He gets a short acknowledgement
  // ("passing this on to be handled") and the owners get an alert; a human answers.
  const complaintLike = isComplaint || triage.intent === "complaint";
  const SOFT_ACK =
    complaintLike ||
    triage.intent === "price_or_discount" ||
    (triage.intent === "general_info" && !grounded) ||
    (triage.intent === "other" && triage.needsReply !== false && triage.classification !== "praise" && triage.classification !== "spam");
  if (SOFT_ACK) {
    const voiceFailed = msg.text.startsWith("🎤 [הודעה קולית — לא הצלחתי לתמלל");
    const ackText = complaintLike
      ? COMPLAINT_ACK
      : voiceFailed
        ? VOICE_FAILED_ACK
        : triage.intent === "price_or_discount"
          ? STORE_HOLDING
          : HOLDING;
    let acked = false;
    let ackFailure: string | null = null;
    if (mode === "active" && autoCount < MAX_CONSECUTIVE_AUTO && !ownerHandling) {
      const r = await executeAction({
        userId: ownerUserId,
        workspaceId,
        actionType: "reply_message",
        payload: { messageId: msg.id, to: msg.authorHandle, text: ackText, channel: msg.channel },
        targetSystem: msg.channel,
      });
      acked = r.ok && r.data?.simulated !== true;
      if (!acked) ackFailure = r.error ?? "השליחה נכשלה";
    }
    await trace(acked, ackText, acked ? null : ackFailure ?? whyNotAutoSent());
    // stays "drafted": a human still has to answer for real
    await updateMessage(ownerUserId, msg.id, { status: "drafted", draftReply: draft, priority: complaintLike ? "urgent" : "high" });
    if (acked) {
      await logActivity({
        userId: ownerUserId,
        workspaceId,
        agent: "social",
        action: `תשובה אוטומטית ל-${msg.authorHandle}: "${ackText.slice(0, 100)}"`,
        tool: msg.channel,
        target: msg.id,
        riskLevel: "green",
        approvalStatus: "auto",
        result: "success",
        autoExecuted: true,
        metadata: { intent: triage.intent, ack: true },
      });
    }
    await notifyOwnersOf(workspaceId, {
      fallbackUserId: ownerUserId,
      kind: "proactive",
      title: complaintLike ? `⚠️ תלונה מ-${whoWithPhone}` : `הודעה מ-${whoWithPhone} — ממתינה לך`,
      body: `"${msg.text.slice(0, 140)}"\n\n${acked ? "ללקוח נשלח: הפנייה בטיפול ונחזור אליו." : `ללקוח לא נשלח כלום (${ackFailure ?? whyNotAutoSent()}).`}`,
      href: "/messages",
      priority: complaintLike ? "urgent" : "high",
    }).catch(() => {});
    return { action: acked ? "auto_replied" : "drafted", detail: ackText };
  }

  const canAutoSend =
    mode === "active" &&
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
      // Routine question answered by the assistant itself — no ping, the owners don't need to act.
      return { action: "auto_replied", detail: draft };
    }
    // send failed → fall through to draft
    autoSendFailure = r.error ?? "השליחה נכשלה";
  }

  // draft-only: park the suggested reply, notify the owners
  await trace(false, draft, autoSendFailure ? `שליחה אוטומטית נכשלה: ${autoSendFailure}` : note ?? whyNotAutoSent());
  await updateMessage(ownerUserId, msg.id, { status: "drafted", draftReply: draft });
  const needsFollowUp =
    isComplaint ||
    (typeof triage.needsReply === "boolean"
      ? triage.needsReply
      : ["lead", "question", "needs_human"].includes(triage.classification) ||
        (triage.intent !== "greeting" && triage.intent !== "other"));
  await notifyOwnersOf(workspaceId, {
    fallbackUserId: ownerUserId,
    // WhatsApp ping ("proactive") only when someone needs to get back to the
    // customer: a question, request/lead, complaint or "talk to a human".
    // Thanks / praise / spam / small talk stay app-only ("info").
    kind: needsFollowUp ? "proactive" : "info",
    title: isComplaint ? `⚠️ תלונה מ-${whoWithPhone}` : `הודעה מ-${whoWithPhone} — ממתינה לך`,
    body: msg.text.slice(0, 140),
    href: "/messages",
    priority: isComplaint ? "urgent" : triage.priority === "urgent" ? "high" : "normal",
  }).catch(() => {});

  return {
    action: bookingApprovalPayload || cancelApprovalPayload ? "approval_created" : "drafted",
    detail: draft,
    approvalId,
  };
}
