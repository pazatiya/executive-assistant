import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { nowIso } from "@/lib/utils";
import { canAccessRow, listScope } from "@/lib/auth/scope";
import { logActivity } from "./activity";

export type Task = typeof tasks.$inferSelect;
export type TaskStatus = Task["status"];

export const TASK_STATUSES: TaskStatus[] = [
  "inbox",
  "planned",
  "in_progress",
  "waiting",
  "waiting_approval",
  "completed",
  "failed",
];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  inbox: "Inbox",
  planned: "מתוכנן",
  in_progress: "בעבודה",
  waiting: "ממתין",
  waiting_approval: "ממתין לאישור",
  completed: "הושלם",
  failed: "נכשל",
};

export interface CreateTaskInput {
  userId: string;
  workspaceId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: Task["priority"];
  dueDate?: string | null;
  createdBy?: Task["createdBy"];
  source?: string;
  goalId?: string | null;
  parentTaskId?: string | null;
  followUpAt?: string | null;
  requiresApproval?: boolean;
  plan?: Task["plan"];
  outcome?: string | null;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const row: Task = {
    id: id("task"),
    userId: input.userId,
    workspaceId: input.workspaceId,
    title: input.title,
    description: input.description ?? "",
    status: input.status ?? "inbox",
    priority: input.priority ?? "normal",
    dueDate: input.dueDate ?? null,
    createdBy: input.createdBy ?? "user",
    assignedTo: "assistant",
    source: input.source ?? "manual",
    parentTaskId: input.parentTaskId ?? null,
    goalId: input.goalId ?? null,
    followUpAt: input.followUpAt ?? null,
    requiresApproval: input.requiresApproval ?? false,
    plan: input.plan ?? [],
    outcome: input.outcome ?? null,
    completedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.insert(tasks).values(row);
  await logActivity({
    userId: input.userId,
    workspaceId: input.workspaceId,
    agent: input.createdBy === "assistant" ? "task" : "orchestrator",
    action: `נוצרה משימה: ${input.title}`,
    tool: "tasks",
    target: row.id,
    result: "success",
    autoExecuted: input.createdBy !== "user",
  });
  return row;
}

export async function updateTask(userId: string, taskId: string, patch: Partial<Task>): Promise<Task | null> {
  const existing = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!existing || !(await canAccessRow(userId, existing))) return null;
  const next = { ...patch, updatedAt: nowIso() };
  if (patch.status === "completed" && !existing.completedAt) next.completedAt = nowIso();
  await db.update(tasks).set(next).where(eq(tasks.id, taskId));
  if (patch.status) {
    await logActivity({
      userId,
      workspaceId: existing.workspaceId,
      action: `סטטוס משימה → ${patch.status}: ${existing.title}`,
      tool: "tasks",
      target: taskId,
      result: patch.status === "failed" ? "failure" : "info",
    });
  }
  return db.query.tasks.findFirst({ where: eq(tasks.id, taskId) }) as Promise<Task>;
}

export async function listTasks(
  userId: string,
  opts: { workspaceId?: string; statuses?: TaskStatus[]; goalId?: string; limit?: number } = {},
) {
  const conds: SQL[] = [
    await listScope({ userId: tasks.userId, workspaceId: tasks.workspaceId }, userId, opts.workspaceId),
  ];
  if (opts.goalId) conds.push(eq(tasks.goalId, opts.goalId));
  if (opts.statuses?.length) conds.push(inArray(tasks.status, opts.statuses));
  return db
    .select()
    .from(tasks)
    .where(and(...conds))
    .orderBy(desc(tasks.updatedAt))
    .limit(opts.limit ?? 200);
}

export async function getTask(userId: string, taskId: string) {
  const row = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  return row && (await canAccessRow(userId, row)) ? row : undefined;
}
