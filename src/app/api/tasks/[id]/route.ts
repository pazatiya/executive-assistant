import { apiContext, bad, ok, readJson } from "@/lib/api";
import { getTask, updateTask } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await apiContext();
  const { id } = await params;
  const body = await readJson<Record<string, unknown>>(req);
  const updated = await updateTask(user.id, id, body as never);
  if (!updated) return bad("משימה לא נמצאה", 404);
  return ok(updated);
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await apiContext();
  const { id } = await params;
  const task = await getTask(user.id, id);
  if (!task) return bad("משימה לא נמצאה", 404);
  return ok(task);
}
