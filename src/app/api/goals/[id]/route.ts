import { apiContext, bad, ok, readJson } from "@/lib/api";
import { updateGoal } from "@/lib/services/goals";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await apiContext();
  const { id } = await params;
  const body = await readJson<Record<string, unknown>>(req);
  const g = await updateGoal(user.id, id, body as never);
  if (!g) return bad("מטרה לא נמצאה", 404);
  return ok(g);
}
