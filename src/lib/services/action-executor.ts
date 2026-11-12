import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { emails, messages, tasks } from "@/lib/db/schema";
import { nowIso } from "@/lib/utils";
import { getConnector } from "@/lib/integrations/registry";
import { createBooking, cancelAppointment } from "@/lib/integrations/dalor-barber";
import { traceMessage } from "./message-trace";
import { sendWhatsApp, sendWhatsAppWindowAware, sendBookingConfirmation, sendBookingCancelConfirmation } from "@/lib/integrations/whatsapp-send";
import { updateReminder } from "@/lib/services/reminders";

export interface ExecuteInput {
  userId: string;
  workspaceId: string | null;
  actionType: string;
  payload: Record<string, unknown>;
  targetSystem?: string;
  approvalId?: string;
}

export interface ExecuteResult {
  ok: boolean;
  actionType: string;
  detail: string;
  error?: string;
  data?: Record<string, unknown>;
}

/**
 * Executes an approved (or auto-approved GREEN) action. Where a real integration
 * exists it is used; otherwise the local record is updated and the executor
 * reports `simulated: true` in its data so nothing pretends to have gone out.
 */
/** "2026-11-09" -> "שני 9/11" (Israel-style short date for customer text). */
function heDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const dow = new Intl.DateTimeFormat("he-IL", { weekday: "long", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
  return `${dow.replace(/^יום\s*/, "")} ${Number(m[3])}/${Number(m[2])}`;
}

export async function executeAction(input: ExecuteInput): Promise<ExecuteResult> {
  const { actionType, payload } = input;

  try {
    switch (actionType) {
      case "send_email": {
        const connector = await getConnector(input.userId, "gmail", input.workspaceId);
        const emailId = payload.emailId as string | undefined;
        let sent: { simulated: boolean; providerId?: string } = { simulated: true };
        if (connector?.status === "connected") {
          const r = await connector.executeAction("send_email", payload);
          sent = { simulated: false, providerId: (r.data?.id as string) ?? undefined };
        }
        if (emailId) {
          await db
            .update(emails)
            .set({ status: "sent", draftReply: (payload.body as string) ?? null, updatedAt: nowIso() })
            .where(eq(emails.id, emailId));
        }
        return {
          ok: true,
          actionType,
          detail: sent.simulated
            ? "התשובה נשמרה ותישלח כשחשבון Gmail יחובר (סימולציה)."
            : "המייל נשלח דרך Gmail.",
          data: { ...sent },
        };
      }

      case "archive_email":
      case "delete_email": {
        const emailId = payload.emailId as string;
        await db.update(emails).set({ status: "archived", updatedAt: nowIso() }).where(eq(emails.id, emailId));
        return { ok: true, actionType, detail: "המייל אורכב.", data: { simulated: true } };
      }

      case "reply_message": {
        const messageId = payload.messageId as string | undefined;
        const text = (payload.text as string) ?? (payload.body as string) ?? "";
        const msg = messageId
          ? await db.query.messages.findFirst({ where: eq(messages.id, messageId) })
          : null;
        const channel = (msg?.channel ?? (payload.channel as string)) as string | undefined;
        const to = (payload.to as string) ?? msg?.authorHandle;

        let sent: { simulated: boolean; providerId?: string } = { simulated: true };
        if (channel === "whatsapp" && to) {
          const r = await sendWhatsAppWindowAware(to, text, msg?.authorName);
          if (!r.ok) return { ok: false, actionType, detail: "", error: r.error ?? "WhatsApp send failed" };
          sent = { simulated: false, providerId: r.providerId };
        } else if ((channel === "instagram" || channel === "facebook") && to) {
          const { sendSocialMessage, metaSocialConfigured } = await import("@/lib/integrations/meta-social");
          if (metaSocialConfigured()) {
            const r = await sendSocialMessage(channel, to, text);
            if (!r.ok) return { ok: false, actionType, detail: "", error: r.error ?? "השליחה נכשלה" };
            sent = { simulated: false, providerId: r.id };
          }
        }

        if (messageId) {
          await db
            .update(messages)
            .set({ status: "replied", draftReply: text, updatedAt: nowIso() })
            .where(eq(messages.id, messageId));
        }
        return {
          ok: true,
          actionType,
          detail: sent.simulated
            ? "התגובה נשמרה ותישלח כשהערוץ יחובר (סימולציה)."
            : channel === "instagram" || channel === "facebook"
              ? `התגובה נשלחה ב${channel === "instagram" ? "אינסטגרם" : "פייסבוק"}.`
              : "הבקשה נשלחה לוואטסאפ — אישור מסירה יופיע בדף ההודעות.",
          data: { ...sent },
        };
      }

      // A message to a phone number that isn't tied to an existing inbox thread
      // — a personal contact ("בעלי", "אמא") found via find_contact, or a
      // customer's number given directly. No case existed for this before,
      // so an approved contact_client action silently had nothing to execute.
      case "contact_client":
      case "message_contact": {
        const phone = payload.phone as string | undefined;
        const body = (payload.body as string) ?? (payload.text as string) ?? "";
        if (!phone || !body) return { ok: false, actionType, detail: "", error: "חסר מספר טלפון או תוכן ההודעה" };
        const { messageCustomer } = await import("./messages");
        const r = await messageCustomer({
          userId: input.userId,
          workspaceId: input.workspaceId,
          phone,
          body,
          customerName: payload.name as string | undefined,
        });
        if (!r.ok) return { ok: false, actionType, detail: "", error: r.error ?? "השליחה נכשלה" };
        return { ok: true, actionType, detail: "הבקשה נשלחה לוואטסאפ — אישור מסירה יופיע בדף ההודעות.", data: { via: r.via, messageId: r.messageId } };
      }

      case "post_social": {
        return {
          ok: true,
          actionType,
          detail: "הפוסט מוכן. פרסום בפועל יופעל כשהערוץ החברתי יחובר.",
          data: { simulated: true, content: payload.content },
        };
      }

      case "create_event":
      case "update_event":
      case "cancel_event": {
        const connector = await getConnector(input.userId, "google_calendar", input.workspaceId);
        if (connector?.status === "connected") {
          const r = await connector.executeAction(actionType, payload);
          return { ok: true, actionType, detail: "היומן עודכן.", data: r.data ?? {} };
        }
        return {
          ok: true,
          actionType,
          detail: "האירוע נרשם מקומית. סנכרון ל-Google Calendar יופעל בחיבור.",
          data: { simulated: true, event: payload },
        };
      }

      case "book_appointment": {
        const date = String(payload.date ?? "");
        const time = String(payload.time ?? "");
        const r = await createBooking({
          fullName: String(payload.fullName ?? "לקוח"),
          phone: String(payload.phone ?? ""),
          date,
          time,
          notes: payload.notes ? String(payload.notes) : undefined,
        });
        const traceTo = (sent: boolean, text: string | null, reason: string | null) =>
          payload.messageId
            ? traceMessage({
                userId: input.userId,
                workspaceId: input.workspaceId ?? null,
                messageId: String(payload.messageId),
                sent,
                text,
                reason,
              })
            : Promise.resolve();
        if (!r.ok) {
          await traceTo(false, null, `קביעת התור נכשלה: ${r.error ?? "שגיאה לא ידועה"} — ללקוח לא נשלחה אישור`);
          return { ok: false, actionType, detail: "", error: r.error ?? "קביעת התור נכשלה" };
        }

        // tell the customer it's confirmed
        const confirmText = `נקבע לך תור ליום ${heDay(date)} בשעה ${time} ✂️ נתראה! אם צריך לשנות — פשוט תכתוב לי כאן.`;
        const replyTo = String(payload.replyTo ?? payload.phone ?? "");
        let confirmSent = false;
        let confirmWhy: string | null = replyTo ? null : "אין מספר טלפון ללקוח";
        if (replyTo) {
          const sr = await sendBookingConfirmation({
            to: replyTo,
            name: String(payload.fullName ?? ""),
            date,
            time,
            service: payload.service ? String(payload.service) : null,
            fallbackText: confirmText,
          }).catch((e) => ({ ok: false as const, error: String(e?.message ?? e) }));
          confirmSent = !!sr.ok;
          if (!sr.ok) confirmWhy = sr.error ?? "השליחה נכשלה";
        }
        await traceTo(confirmSent, confirmSent ? confirmText : null, confirmWhy);
        const messageId = payload.messageId as string | undefined;
        if (messageId)
          // draftReply must show what the customer actually got (the confirmation),
          // not the earlier "passing it for approval" draft that was never sent.
          await db
            .update(messages)
            .set({ status: "replied", draftReply: confirmSent ? confirmText : null, updatedAt: nowIso() })
            .where(eq(messages.id, messageId));
        return {
          ok: true,
          actionType,
          detail: `תור נקבע — ${date} ${time}` + (confirmSent ? "" : ` (אישור ללקוח לא נשלח: ${confirmWhy}) — לעדכן ידנית`),
          data: r.data ?? {},
        };
      }

      case "cancel_appointment": {
        const appointmentId = String(payload.appointmentId ?? "");
        const date = String(payload.date ?? "");
        const time = String(payload.time ?? "");
        if (!appointmentId) return { ok: false, actionType, detail: "", error: "חסר מזהה תור לביטול" };
        const r = await cancelAppointment(appointmentId);
        const traceCancel = (sent: boolean, text: string | null, reason: string | null) =>
          payload.messageId
            ? traceMessage({
                userId: input.userId,
                workspaceId: input.workspaceId ?? null,
                messageId: String(payload.messageId),
                sent,
                text,
                reason,
              })
            : Promise.resolve();
        if (!r.ok) {
          await traceCancel(false, null, `ביטול התור נכשל: ${r.error ?? "שגיאה לא ידועה"} — ללקוח לא נשלחה הודעה`);
          return { ok: false, actionType, detail: "", error: r.error ?? "ביטול התור נכשל" };
        }

        // answer the customer in the chat they asked in (the booking system only
        // messages customers who consented to WhatsApp reminders)
        const cancelText = `ביטלתי לך את התור ליום ${heDay(date)} בשעה ${time}. כשתרצה לקבוע תור חדש — פשוט תכתוב לי כאן ✂️`;
        const replyTo = String(payload.replyTo ?? payload.phone ?? "");
        let sent = false;
        let sentWhy: string | null = replyTo ? null : "אין מספר טלפון ללקוח";
        if (replyTo) {
          const sr = await sendBookingCancelConfirmation({
            to: replyTo,
            name: String(payload.fullName ?? ""),
            date,
            time,
            fallbackText: cancelText,
          }).catch((e) => ({ ok: false as const, error: String(e?.message ?? e) }));
          sent = !!sr.ok;
          if (!sr.ok) sentWhy = sr.error ?? "השליחה נכשלה";
        }
        await traceCancel(sent, sent ? cancelText : null, sentWhy);
        const messageId = payload.messageId as string | undefined;
        if (messageId)
          await db
            .update(messages)
            .set({ status: "replied", draftReply: sent ? cancelText : null, updatedAt: nowIso() })
            .where(eq(messages.id, messageId));
        return {
          ok: true,
          actionType,
          detail: `התור בוטל — ${date} ${time}` + (sent ? "" : " (הודעת הביטול ללקוח לא נשלחה — לעדכן ידנית)"),
          data: r.data ?? {},
        };
      }

      case "update_crm": {
        return { ok: true, actionType, detail: "רשומת ה-CRM עודכנה (מקומי).", data: { ...payload } };
      }

      case "complete_task": {
        await db
          .update(tasks)
          .set({ status: "completed", completedAt: nowIso(), updatedAt: nowIso() })
          .where(eq(tasks.id, payload.taskId as string));
        return { ok: true, actionType, detail: "המשימה סומנה כהושלמה.", data: {} };
      }

      // "Delete" a reminder = cancel it, not a hard row delete — same reasoning
      // as tasks (complete_task above): keep the audit trail in /activity.
      case "delete_reminders":
      case "delete_reminder":
      case "cancel_reminders":
      case "cancel_reminder": {
        const ids = Array.isArray(payload.reminderIds)
          ? (payload.reminderIds as string[])
          : payload.reminderId
            ? [payload.reminderId as string]
            : [];
        if (!ids.length) return { ok: false, actionType, detail: "", error: "חסר reminderIds/reminderId" };
        let cancelled = 0;
        for (const id of ids) {
          const r = await updateReminder(input.userId, id, { status: "cancelled" });
          if (r) cancelled++;
        }
        if (!cancelled) return { ok: false, actionType, detail: "", error: "לא נמצאה אף תזכורת מהרשימה לביטול" };
        return {
          ok: true,
          actionType,
          detail: `${cancelled}/${ids.length} תזכורות בוטלו.`,
          data: { cancelled, requested: ids.length },
        };
      }

      case "browser_action": {
        return {
          ok: true,
          actionType,
          detail: "Browser Agent עדיין לא מחובר — הפעולה תועדה ותרוץ כשהיכולת תופעל.",
          data: { simulated: true, steps: payload.steps ?? [] },
        };
      }

      default:
        return { ok: false, actionType, detail: "", error: `לא ידוע איך לבצע פעולה מסוג "${actionType}"` };
    }
  } catch (e) {
    return { ok: false, actionType, detail: "", error: e instanceof Error ? e.message : String(e) };
  }
}
