import { apiContext, bad, ok, readJson } from "@/lib/api";
import { createReminder, listReminders } from "@/lib/services/reminders";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { user } = await apiContext(req);
  return ok(await listReminders(user.id, {}));
}

export async function POST(req: Request) {
  const { user, workspaceId } = await apiContext(req);
  const body = await readJson<{
    title: string;
    dueAt: string;
    description?: string;
    kind?: string;
    recurrence?: string | null;
    condition?: string | null;
  }>(req);
  if (!body.title?.trim() || !body.dueAt) return bad("חסר כותרת או מועד");
  const r = await createReminder({
    userId: user.id,
    workspaceId,
    title: body.title.trim(),
    description: body.description,
    kind: body.kind as never,
    dueAt: new Date(body.dueAt).toISOString(),
    recurrence: body.recurrence ?? null,
    condition: body.condition ?? null,
  });
  return ok(r, 201);
}
