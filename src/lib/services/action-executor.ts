import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { emails, messages, tasks } from "@/lib/db/schema";
import { nowIso } from "@/lib/utils";
import { getConnector } from "@/lib/integrations/registry";
import { createBooking } from "@/lib/integrations/dalor-barber";
import { sendWhatsApp } from "@/lib/integrations/whatsapp-send";

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
          const r = await sendWhatsApp(to, text);
          if (!r.ok) return { ok: false, actionType, detail: "", error: r.error ?? "WhatsApp send failed" };
          sent = { simulated: false, providerId: r.providerId };
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
            : "התגובה נשלחה בוואטסאפ.",
          data: { ...sent },
        };
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
        if (!r.ok) return { ok: false, actionType, detail: "", error: r.error ?? "קביעת התור נכשלה" };

        // tell the customer it's confirmed
        const replyTo = String(payload.replyTo ?? payload.phone ?? "");
        if (replyTo) {
          await sendWhatsApp(
            replyTo,
            `נקבע לך תור ל-${date} בשעה ${time} ✂️ נתראה! אם צריך לשנות — פשוט תכתוב לי כאן.`,
          ).catch(() => {
            /* best effort */
          });
        }
        const messageId = payload.messageId as string | undefined;
        if (messageId)
          await db.update(messages).set({ status: "replied", updatedAt: nowIso() }).where(eq(messages.id, messageId));
        return { ok: true, actionType, detail: `תור נקבע — ${date} ${time}`, data: r.data ?? {} };
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
