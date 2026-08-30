import { apiContext, ok } from "@/lib/api";
import { listActivity } from "@/lib/services/activity";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { user } = await apiContext(req);
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 150);
  return ok(await listActivity(user.id, { limit }));
}
