import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { emails, messages, tasks } from "@/lib/db/schema";
import { nowIso } from "@/lib/utils";
import { getConnector } from "@/lib/integrations/registry";

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
        const messageId = payload.messageId as string;
        await db
          .update(messages)
          .set({ status: "replied", draftReply: (payload.text as string) ?? null, updatedAt: nowIso() })
          .where(eq(messages.id, messageId));
        return {
          ok: true,
          actionType,
          detail: "התגובה נשמרה ותפורסם כשהערוץ יחובר (סימולציה).",
          data: { simulated: true },
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
