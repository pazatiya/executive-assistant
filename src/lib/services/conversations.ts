import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversationMessages, conversations } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { nowIso } from "@/lib/utils";
import { canAccessRow, listScope } from "@/lib/auth/scope";

export type Conversation = typeof conversations.$inferSelect;
export type ConversationMessage = typeof conversationMessages.$inferSelect;

export async function listConversations(userId: string) {
  const where = await listScope(
    { userId: conversations.userId, workspaceId: conversations.workspaceId },
    userId,
  );
  return db
    .select()
    .from(conversations)
    .where(where)
    .orderBy(desc(conversations.lastMessageAt))
    .limit(50);
}

export async function getOrCreateConversation(
  userId: string,
  conversationId: string | null,
  workspaceId: string | null,
): Promise<Conversation> {
  if (conversationId) {
    const found = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) });
    if (found && (await canAccessRow(userId, found))) return found;
  }
  const row: Conversation = {
    id: id("conv"),
    userId,
    workspaceId,
    title: "שיחה חדשה",
    lastMessageAt: nowIso(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.insert(conversations).values(row);
  return row;
}

export async function getMessages(conversationId: string): Promise<ConversationMessage[]> {
  return db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(asc(conversationMessages.createdAt));
}

export async function addMessage(
  conversationId: string,
  role: ConversationMessage["role"],
  content: string,
  trace?: ConversationMessage["trace"],
): Promise<ConversationMessage> {
  const row: ConversationMessage = {
    id: id("msg"),
    conversationId,
    role,
    content,
    trace: trace ?? null,
    createdAt: nowIso(),
  };
  await db.insert(conversationMessages).values(row);
  await db
    .update(conversations)
    .set({ lastMessageAt: nowIso(), updatedAt: nowIso() })
    .where(eq(conversations.id, conversationId));
  return row;
}

export async function setConversationTitle(conversationId: string, title: string) {
  await db.update(conversations).set({ title, updatedAt: nowIso() }).where(eq(conversations.id, conversationId));
}
