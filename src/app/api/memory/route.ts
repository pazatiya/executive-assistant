import { apiContext, bad, ok, readJson } from "@/lib/api";
import { createMemory, listMemories } from "@/lib/services/memory";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { user, workspaceId } = await apiContext(req);
  return ok(await listMemories(user.id, { workspaceId }));
}

export async function POST(req: Request) {
  const { user, workspaceId } = await apiContext(req);
  const body = await readJson<{
    subject: string;
    content: string;
    type?: string;
    ruleKind?: string;
    ruleTarget?: string;
    importance?: string;
    global?: boolean;
  }>(req);
  if (!body.subject?.trim() || !body.content?.trim()) return bad("חסר נושא או תוכן");
  const m = await createMemory({
    userId: user.id,
    workspaceId: body.global ? null : workspaceId,
    type: body.type as never,
    subject: body.subject.trim(),
    content: body.content.trim(),
    ruleKind: (body.ruleKind as never) ?? null,
    ruleTarget: body.ruleTarget ?? null,
    importance: body.importance as never,
    source: "user",
  });
  return ok(m, 201);
}
