import { apiContext, bad, ok, readJson } from "@/lib/api";
import { createTask, listTasks, type TaskStatus } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { user, workspaceId } = await apiContext(req);
  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1";
  return ok(await listTasks(user.id, { workspaceId: all ? undefined : workspaceId }));
}

export async function POST(req: Request) {
  const { user, workspaceId } = await apiContext(req);
  const body = await readJson<{
    title: string;
    description?: string;
    priority?: string;
    dueDate?: string | null;
    status?: TaskStatus;
    goalId?: string | null;
  }>(req);
  if (!body.title?.trim()) return bad("כותרת חסרה");
  const task = await createTask({
    userId: user.id,
    workspaceId,
    title: body.title.trim(),
    description: body.description,
    priority: body.priority as never,
    dueDate: body.dueDate ?? null,
    status: body.status,
    goalId: body.goalId ?? null,
    createdBy: "user",
    source: "manual",
  });
  return ok(task, 201);
}
