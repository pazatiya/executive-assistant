import { apiContext, bad, ok, readJson } from "@/lib/api";
import { orchestrate } from "@/lib/agents/orchestrator";
import { getOrCreateConversation, listConversations, getMessages } from "@/lib/services/conversations";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { user } = await apiContext();
  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversationId");
  if (conversationId) {
    return ok({ messages: await getMessages(conversationId) });
  }
  return ok({ conversations: await listConversations(user.id) });
}

export async function POST(req: Request) {
  const { user, workspaceId } = await apiContext(req);
  const body = await readJson<{
    message: string;
    conversationId?: string | null;
    attachments?: { kind: "document" | "email" | "url" | "text"; ref: string }[];
  }>(req);
  if (!body.message?.trim() && !body.attachments?.length) return bad("הודעה ריקה");

  const conversation = await getOrCreateConversation(user.id, body.conversationId ?? null, workspaceId);
  const result = await orchestrate({
    userId: user.id,
    workspaceId,
    conversationId: conversation.id,
    message: body.message?.trim() || "תטפלי בזה (ראי צרופה)",
    attachments: body.attachments,
  });

  return ok({ conversationId: conversation.id, reply: result.reply, trace: result.trace });
}
