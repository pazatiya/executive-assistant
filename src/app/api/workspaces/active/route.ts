import { cookies } from "next/headers";
import { apiContext, bad, ok, readJson } from "@/lib/api";
import { getWorkspace } from "@/lib/services/workspaces";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { user } = await apiContext();
  const { workspaceId } = await readJson<{ workspaceId: string }>(req);
  const ws = await getWorkspace(user.id, workspaceId);
  if (!ws) return bad("workspace לא נמצא", 404);
  const jar = await cookies();
  jar.set("ea_workspace", workspaceId, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return ok({ activeWorkspaceId: workspaceId });
}
