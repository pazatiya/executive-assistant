import { apiContext, bad, ok, readJson } from "@/lib/api";
import { createGoal, listGoals } from "@/lib/services/goals";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { user, workspaceId } = await apiContext(req);
  return ok(await listGoals(user.id, { workspaceId }));
}

export async function POST(req: Request) {
  const { user, workspaceId } = await apiContext(req);
  const body = await readJson<{
    title: string;
    description?: string;
    metric?: string;
    target?: string;
    deadline?: string;
  }>(req);
  if (!body.title?.trim()) return bad("כותרת חסרה");
  const g = await createGoal({
    userId: user.id,
    workspaceId,
    title: body.title.trim(),
    description: body.description,
    metric: body.metric ?? null,
    target: body.target ?? null,
    deadline: body.deadline ?? null,
  });
  return ok(g, 201);
}
