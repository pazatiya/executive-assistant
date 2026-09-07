import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { approvals } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { nowIso } from "@/lib/utils";
import { canAccessRow, listScope } from "@/lib/auth/scope";
import type { RiskLevel } from "@/lib/approval/engine";
import { logActivity } from "./activity";
import { executeAction } from "./action-executor";
import { notifyOwnersOf } from "./notifications";

export type Approval = typeof approvals.$inferSelect;

export interface CreateApprovalInput {
  userId: string;
  workspaceId?: string | null;
  title: string;
  context?: string;
  actionType: string;
  actionPayload?: Record<string, unknown>;
  targetSystem?: string;
  riskLevel: RiskLevel;
  reason: string;
  preview?: string;
  proposedBy?: string;
  relatedTaskId?: string | null;
  relatedConversationId?: string | null;
  expiresInHours?: number;
  /** also raise an app notification for the owners (default: true for yellow/red) */
  notifyOwners?: boolean;
}

export async function createApproval(input: CreateApprovalInput): Promise<Approval> {
  const row: Approval = {
    id: id("apr"),
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    title: input.title,
    context: input.context ?? "",
    actionType: input.actionType,
    actionPayload: input.actionPayload ?? {},
    targetSystem: input.targetSystem ?? "",
    riskLevel: input.riskLevel,
    reason: input.reason,
    preview: input.preview ?? "",
    proposedBy: input.proposedBy ?? "orchestrator",
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    editedPayload: null,
    executionResult: null,
    relatedTaskId: input.relatedTaskId ?? null,
    relatedConversationId: input.relatedConversationId ?? null,
    expiresAt: input.expiresInHours
      ? new Date(Date.now() + input.expiresInHours * 3600_000).toISOString()
      : null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.insert(approvals).values(row);
  await logActivity({
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    agent: input.proposedBy ?? "orchestrator",
    action: `הועלה לאישור: ${input.title}`,
    tool: input.targetSystem || undefined,
    target: row.id,
    riskLevel: input.riskLevel,
    approvalStatus: "pending",
    result: "waiting",
    autoExecuted: false,
  });

  const shouldNotify = input.notifyOwners ?? input.riskLevel !== "green";
  if (shouldNotify) {
    await notifyOwnersOf(input.workspaceId ?? null, {
      fallbackUserId: input.userId,
      kind: "approval_pending",
      title: `${row.riskLevel === "red" ? "🔴" : "🟡"} אישור: ${row.title}`,
      body: `${row.preview || row.reason}\n\nלאישור: השב "אשר" (או "סטטוס" לרשימה).`.slice(0, 300),
      href: "/approvals",
      priority: row.riskLevel === "red" ? "urgent" : "high",
    }).catch(() => {});
  }

  return row;
}

export async function listApprovals(
  userId: string,
  opts: { workspaceId?: string; statuses?: Approval["status"][]; limit?: number } = {},
) {
  const conds: SQL[] = [
    await listScope({ userId: approvals.userId, workspaceId: approvals.workspaceId }, userId, opts.workspaceId),
  ];
  if (opts.statuses?.length) conds.push(inArray(approvals.status, opts.statuses));
  return db
    .select()
    .from(approvals)
    .where(and(...conds))
    .orderBy(desc(approvals.createdAt))
    .limit(opts.limit ?? 100);
}

export async function getApproval(userId: string, aprId: string) {
  const row = await db.query.approvals.findFirst({ where: eq(approvals.id, aprId) });
  return row && (await canAccessRow(userId, row)) ? row : undefined;
}

export type Decision = "approve" | "reject" | "edit_approve";

export async function decideApproval(
  userId: string,
  aprId: string,
  decision: Decision,
  opts: { editedPayload?: Record<string, unknown>; decidedBy?: string } = {},
) {
  const apr = await getApproval(userId, aprId);
  if (!apr) return { ok: false as const, error: "not_found" };
  if (apr.status !== "pending") return { ok: false as const, error: `already ${apr.status}` };

  if (decision === "reject") {
    await db
      .update(approvals)
      .set({ status: "rejected", decidedBy: opts.decidedBy ?? "user", decidedAt: nowIso(), updatedAt: nowIso() })
      .where(eq(approvals.id, aprId));
    await logActivity({
      userId,
      workspaceId: apr.workspaceId,
      action: `אישור נדחה: ${apr.title}`,
      target: aprId,
      riskLevel: apr.riskLevel,
      approvalStatus: "rejected",
      result: "info",
      autoExecuted: false,
    });
    return { ok: true as const, status: "rejected" as const };
  }

  const payload = decision === "edit_approve" ? { ...apr.actionPayload, ...(opts.editedPayload ?? {}) } : apr.actionPayload;
  await db
    .update(approvals)
    .set({
      status: decision === "edit_approve" ? "edited_approved" : "approved",
      editedPayload: decision === "edit_approve" ? payload : null,
      decidedBy: opts.decidedBy ?? "user",
      decidedAt: nowIso(),
      updatedAt: nowIso(),
    })
    .where(eq(approvals.id, aprId));

  // execute the underlying action now that it's approved
  const result = await executeAction({
    userId,
    workspaceId: apr.workspaceId,
    actionType: apr.actionType,
    payload,
    targetSystem: apr.targetSystem,
    approvalId: aprId,
  });

  await db
    .update(approvals)
    .set({
      status: result.ok ? "executed" : "failed",
      executionResult: result as unknown as Record<string, unknown>,
      updatedAt: nowIso(),
    })
    .where(eq(approvals.id, aprId));

  await logActivity({
    userId,
    workspaceId: apr.workspaceId,
    agent: apr.proposedBy,
    action: `${result.ok ? "בוצע לאחר אישור" : "כשל בביצוע לאחר אישור"}: ${apr.title}`,
    tool: apr.targetSystem || undefined,
    target: aprId,
    riskLevel: apr.riskLevel,
    approvalStatus: "approved",
    approvedBy: opts.decidedBy ?? "user",
    result: result.ok ? "success" : "failure",
    error: result.ok ? null : result.error,
    autoExecuted: false,
    metadata: result as unknown as Record<string, unknown>,
  });

  return { ok: true as const, status: result.ok ? ("executed" as const) : ("failed" as const), result };
}

export async function alwaysAllowFromApproval(userId: string, aprId: string) {
  // Records a permanent memory rule so this action type stops requiring approval.
  const apr = await getApproval(userId, aprId);
  if (!apr) return { ok: false as const };
  if (apr.riskLevel === "red") return { ok: false as const, error: "red actions can never be auto-approved" };
  const { createMemory } = await import("./memory");
  await createMemory({
    userId,
    workspaceId: apr.workspaceId,
    type: "permanent",
    subject: `אישור אוטומטי: ${apr.actionType}`,
    content: `מעכשיו לבצע פעולות מסוג "${apr.actionType}" למערכת ${apr.targetSystem || "כללי"} ללא אישור.`,
    ruleKind: "auto_reply_allowed",
    ruleTarget: apr.actionType,
    importance: "high",
    source: `approval:${aprId}`,
  });
  return { ok: true as const };
}
