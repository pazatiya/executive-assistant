import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { goals } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { clamp, nowIso } from "@/lib/utils";
import { logActivity } from "./activity";

export type Goal = typeof goals.$inferSelect;

export interface CreateGoalInput {
  userId: string;
  workspaceId: string;
  title: string;
  description?: string;
  metric?: string | null;
  target?: string | null;
  currentValue?: string | null;
  deadline?: string | null;
  strategy?: Goal["strategy"];
}

export async function createGoal(input: CreateGoalInput): Promise<Goal> {
  const row: Goal = {
    id: id("goal"),
    userId: input.userId,
    workspaceId: input.workspaceId,
    title: input.title,
    description: input.description ?? "",
    metric: input.metric ?? null,
    target: input.target ?? null,
    currentValue: input.currentValue ?? null,
    deadline: input.deadline ?? null,
    status: "active",
    progress: 0,
    strategy: input.strategy ?? {},
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.insert(goals).values(row);
  await logActivity({
    userId: input.userId,
    workspaceId: input.workspaceId,
    action: `נוצרה מטרה: ${input.title}`,
    tool: "goals",
    target: row.id,
    result: "success",
  });
  return row;
}

export async function listGoals(userId: string, opts: { workspaceId?: string } = {}) {
  const conds = [eq(goals.userId, userId)];
  if (opts.workspaceId) conds.push(eq(goals.workspaceId, opts.workspaceId));
  return db.select().from(goals).where(and(...conds)).orderBy(desc(goals.updatedAt));
}

export async function getGoal(userId: string, goalId: string) {
  return db.query.goals.findFirst({ where: and(eq(goals.id, goalId), eq(goals.userId, userId)) });
}

export async function updateGoal(userId: string, goalId: string, patch: Partial<Goal>) {
  const g = await getGoal(userId, goalId);
  if (!g) return null;
  if (typeof patch.progress === "number") patch.progress = clamp(patch.progress, 0, 100);
  await db.update(goals).set({ ...patch, updatedAt: nowIso() }).where(eq(goals.id, goalId));
  return db.query.goals.findFirst({ where: eq(goals.id, goalId) });
}
