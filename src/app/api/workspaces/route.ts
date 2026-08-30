import { apiContext, bad, ok, readJson } from "@/lib/api";
import { createWorkspace, listWorkspaces } from "@/lib/services/workspaces";
import { ensureIntegrationRows } from "@/lib/integrations/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await apiContext();
  return ok(await listWorkspaces(user.id));
}

export async function POST(req: Request) {
  const { user } = await apiContext();
  const body = await readJson<{ name: string; type?: string; description?: string; color?: string; icon?: string }>(req);
  if (!body.name?.trim()) return bad("שם workspace חסר");
  const ws = await createWorkspace({
    userId: user.id,
    name: body.name.trim(),
    type: body.type as never,
    description: body.description,
    color: body.color,
    icon: body.icon,
  });
  await ensureIntegrationRows(user.id);
  return ok(ws, 201);
}
