import { apiContext, bad, ok, readJson } from "@/lib/api";
import { getAssistantMode, setAssistantMode } from "@/lib/services/workspaces";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { workspaceId } = await apiContext(req);
  return ok({ mode: await getAssistantMode(workspaceId) });
}

export async function POST(req: Request) {
  const { user, workspaceId } = await apiContext(req);
  const body = await readJson<{ mode?: "draft_only" | "active" }>(req);
  if (body.mode !== "draft_only" && body.mode !== "active") return bad("mode לא תקין");
  const r = await setAssistantMode(user.id, workspaceId, body.mode);
  if (!r) return bad("workspace לא נמצא", 404);
  return ok({ mode: r });
}
