import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { automationRules } from "@/lib/db/schema";
import { nowIso } from "@/lib/utils";
import { classifyAction, type ActionType } from "@/lib/approval/engine";
import { createApproval } from "@/lib/services/approvals";
import { executeAction } from "@/lib/services/action-executor";
import { createTask } from "@/lib/services/tasks";
import { logActivity } from "@/lib/services/activity";

export type AutomationEvent =
  | "email.received"
  | "message.received"
  | "reminder.due"
  | "task.overdue"
  | "lead.detected";

export interface Condition {
  field: string; // dot-path into the event payload
  op: "contains" | "equals" | "exists" | "gt" | "lt";
  value?: string | number;
}

export const RULE_TEMPLATES: {
  name: string;
  trigger: AutomationEvent;
  condition: Condition;
  actionType: string;
  actionPayloadHint: string;
  forceApproval: boolean;
}[] = [
  {
    name: "ליד חדש במייל → הכיני טיוטת תשובה לאישור",
    trigger: "email.received",
    condition: { field: "category", op: "equals", value: "lead" },
    actionType: "draft_email_reply",
    actionPayloadHint: "טיוטה ראשונית + העלאה לאישור",
    forceApproval: true,
  },
  {
    name: "תלונה ברשת חברתית → משימה דחופה + טיוטת תגובה",
    trigger: "message.received",
    condition: { field: "classification", op: "equals", value: "complaint" },
    actionType: "create_task",
    actionPayloadHint: "משימה בעדיפות גבוהה",
    forceApproval: false,
  },
  {
    name: "חשבונית במייל → משימה 'לבדוק ולשלם' (RED, אישור)",
    trigger: "email.received",
    condition: { field: "category", op: "equals", value: "invoice" },
    actionType: "create_task",
    actionPayloadHint: "מעקב תשלום — תשלום עצמו תמיד באישור",
    forceApproval: false,
  },
];

function resolvePath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
}

function evalCondition(cond: Condition, payload: Record<string, unknown>): boolean {
  if (!cond?.field) return true;
  const actual = resolvePath(payload, cond.field);
  switch (cond.op) {
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "equals":
      return String(actual) === String(cond.value);
    case "contains":
      return String(actual ?? "").toLowerCase().includes(String(cond.value ?? "").toLowerCase());
    case "gt":
      return Number(actual) > Number(cond.value);
    case "lt":
      return Number(actual) < Number(cond.value);
    default:
      return false;
  }
}

export interface AutomationRunResult {
  ruleId: string;
  ruleName: string;
  outcome: "approval_created" | "executed" | "task_created" | "skipped" | "failed";
  detail: string;
}

/** Called by ingest paths (gmail sync, reminder tick, social sync). */
export async function runAutomations(
  userId: string,
  event: AutomationEvent,
  payload: Record<string, unknown> & { workspaceId?: string | null },
): Promise<AutomationRunResult[]> {
  const rules = await db
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.userId, userId), eq(automationRules.trigger, event), eq(automationRules.enabled, true)));

  const results: AutomationRunResult[] = [];

  for (const rule of rules) {
    const cond = rule.condition as unknown as Condition;
    if (!evalCondition(cond, payload)) {
      results.push({ ruleId: rule.id, ruleName: rule.name, outcome: "skipped", detail: "התנאי לא התקיים" });
      continue;
    }

    const workspaceId = (payload.workspaceId as string | undefined) ?? rule.workspaceId ?? null;
    const mergedPayload = { ...(rule.actionPayload as Record<string, unknown>), ...payload };

    try {
      if (rule.actionType === "create_task") {
        const t = await createTask({
          userId,
          workspaceId: workspaceId ?? (payload.workspaceId as string) ?? "",
          title: (mergedPayload.title as string) ?? `אוטומציה: ${rule.name}`,
          description: `נוצר אוטומטית ע"י החוק "${rule.name}" מאירוע ${event}.`,
          priority: (mergedPayload.priority as never) ?? "high",
          createdBy: "system",
          source: `automation:${rule.id}`,
        });
        results.push({ ruleId: rule.id, ruleName: rule.name, outcome: "task_created", detail: t.title });
      } else {
        const cls = await classifyAction({
          userId,
          workspaceId,
          actionType: rule.actionType as ActionType,
          targetSystem: (mergedPayload.targetSystem as string) ?? "",
          negativeSentiment: payload.sentiment === "negative" || payload.classification === "complaint",
        });

        if (rule.forceApproval || cls.requiresApproval || !cls.autoExecutable) {
          const a = await createApproval({
            userId,
            workspaceId,
            title: `אוטומציה: ${rule.name}`,
            context: `אירוע ${event} · ${JSON.stringify(payload).slice(0, 300)}`,
            actionType: rule.actionType,
            actionPayload: mergedPayload,
            targetSystem: (mergedPayload.targetSystem as string) ?? "",
            riskLevel: cls.riskLevel,
            reason: rule.forceApproval ? "החוק מוגדר לדרוש אישור תמיד." : cls.reason,
            preview: (mergedPayload.preview as string) ?? (mergedPayload.body as string) ?? (mergedPayload.text as string) ?? "",
            proposedBy: "automation",
          });
          results.push({ ruleId: rule.id, ruleName: rule.name, outcome: "approval_created", detail: a.id });
        } else {
          const r = await executeAction({ userId, workspaceId, actionType: rule.actionType, payload: mergedPayload });
          results.push({
            ruleId: rule.id,
            ruleName: rule.name,
            outcome: r.ok ? "executed" : "failed",
            detail: r.detail || r.error || "",
          });
        }
      }
    } catch (e) {
      results.push({ ruleId: rule.id, ruleName: rule.name, outcome: "failed", detail: e instanceof Error ? e.message : String(e) });
    }

    await db
      .update(automationRules)
      .set({ lastRunAt: nowIso(), runCount: rule.runCount + 1, updatedAt: nowIso() })
      .where(eq(automationRules.id, rule.id));
  }

  if (results.some((r) => r.outcome !== "skipped")) {
    await logActivity({
      userId,
      workspaceId: (payload.workspaceId as string) ?? null,
      agent: "automation",
      action: `אוטומציה על ${event}: ${results.filter((r) => r.outcome !== "skipped").map((r) => `${r.ruleName} (${r.outcome})`).join(", ")}`,
      tool: "automation",
      result: "info",
    });
  }

  return results;
}
