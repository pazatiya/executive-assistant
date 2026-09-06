import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityLogs } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { listScope } from "@/lib/auth/scope";

export interface LogInput {
  userId: string;
  workspaceId?: string | null;
  agent?: string;
  action: string;
  tool?: string | null;
  target?: string | null;
  riskLevel?: "green" | "yellow" | "red" | "none";
  approvalStatus?: "not_required" | "pending" | "approved" | "rejected" | "auto";
  approvedBy?: string | null;
  result?: "success" | "failure" | "info" | "waiting";
  error?: string | null;
  autoExecuted?: boolean;
  metadata?: Record<string, unknown>;
}

export async function logActivity(input: LogInput) {
  const row = {
    id: id("act"),
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    agent: input.agent ?? "orchestrator",
    action: input.action,
    tool: input.tool ?? null,
    target: input.target ?? null,
    riskLevel: input.riskLevel ?? "none",
    approvalStatus: input.approvalStatus ?? "not_required",
    approvedBy: input.approvedBy ?? null,
    result: input.result ?? "info",
    error: input.error ?? null,
    autoExecuted: input.autoExecuted ?? true,
    metadata: input.metadata ?? {},
  };
  await db.insert(activityLogs).values(row);
  return row;
}

export async function listActivity(userId: string, opts: { workspaceId?: string; limit?: number } = {}) {
  const where = await listScope(
    { userId: activityLogs.userId, workspaceId: activityLogs.workspaceId },
    userId,
    opts.workspaceId,
  );
  return db.select().from(activityLogs).where(where).orderBy(desc(activityLogs.createdAt)).limit(opts.limit ?? 100);
}
