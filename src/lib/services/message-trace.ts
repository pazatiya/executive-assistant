/**
 * "What actually happened with this customer message" — one row per outcome
 * (sent to the customer / NOT sent and why), shown in the messages inbox so the
 * owners never have to guess whether the customer saw anything.
 *
 * Stored in activity_logs (tool = "msg_trace", target = messageId) — no schema change.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityLogs } from "@/lib/db/schema";
import { logActivity } from "./activity";

export const TRACE_TOOL = "msg_trace";

export interface TraceEntry {
  at: string;
  sent: boolean;
  text: string | null;
  reason: string | null;
}

export async function traceMessage(input: {
  userId: string;
  workspaceId?: string | null;
  messageId: string;
  sent: boolean;
  text?: string | null;
  reason?: string | null;
}) {
  await logActivity({
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    agent: "social",
    action: input.sent
      ? `נשלח ללקוח: "${(input.text ?? "").slice(0, 120)}"`
      : `לא נשלח ללקוח: ${input.reason ?? "ללא סיבה מתועדת"}`,
    tool: TRACE_TOOL,
    target: input.messageId,
    result: input.sent ? "success" : "info",
    autoExecuted: true,
    metadata: { sent: input.sent, text: input.text ?? null, reason: input.reason ?? null },
  }).catch(() => {
    /* tracing must never break the flow it describes */
  });
}

/** Oldest-first trace per message id. Never throws (the inbox must always render). */
export async function tracesFor(messageIds: string[]): Promise<Map<string, TraceEntry[]>> {
  const out = new Map<string, TraceEntry[]>();
  if (!messageIds.length) return out;
  const rows = await db
    .select({ target: activityLogs.target, createdAt: activityLogs.createdAt, metadata: activityLogs.metadata })
    .from(activityLogs)
    .where(and(eq(activityLogs.tool, TRACE_TOOL), inArray(activityLogs.target, messageIds)))
    .orderBy(asc(activityLogs.createdAt))
    .catch(() => []);
  for (const r of rows) {
    if (!r.target) continue;
    const md = (r.metadata ?? {}) as { sent?: boolean; text?: string | null; reason?: string | null };
    const list = out.get(r.target) ?? [];
    list.push({ at: r.createdAt, sent: md.sent === true, text: md.text ?? null, reason: md.reason ?? null });
    out.set(r.target, list);
  }
  return out;
}
