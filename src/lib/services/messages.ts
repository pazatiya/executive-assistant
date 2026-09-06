import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { nowIso } from "@/lib/utils";
import { canAccessRow, listScope } from "@/lib/auth/scope";
import { logActivity } from "./activity";

export type Message = typeof messages.$inferSelect;

export interface CreateInboundMessageInput {
  userId: string;
  workspaceId?: string | null;
  integrationId?: string | null;
  channel: Message["channel"];
  kind?: Message["kind"];
  externalId?: string | null;
  authorHandle: string;
  authorName?: string | null;
  text: string;
  receivedAt?: string;
  classification?: Message["classification"];
  sentiment?: Message["sentiment"];
  priority?: Message["priority"];
  source?: Message["source"];
}

export async function findMessageByExternalId(channel: Message["channel"], externalId: string) {
  return db.query.messages.findFirst({
    where: and(eq(messages.channel, channel), eq(messages.externalId, externalId)),
  });
}

export async function createInboundMessage(input: CreateInboundMessageInput): Promise<Message> {
  const row: Message = {
    id: id("smsg"),
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    integrationId: input.integrationId ?? null,
    channel: input.channel,
    kind: input.kind ?? "dm",
    externalId: input.externalId ?? null,
    authorHandle: input.authorHandle,
    authorName: input.authorName ?? null,
    text: input.text,
    receivedAt: input.receivedAt ?? nowIso(),
    classification: input.classification ?? "other",
    sentiment: input.sentiment ?? "neutral",
    priority: input.priority ?? "normal",
    status: "new",
    draftReply: null,
    source: input.source ?? "live",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.insert(messages).values(row);
  await logActivity({
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    agent: "social",
    action: `הודעה נכנסת (${input.channel}) מ-${input.authorName || input.authorHandle}`,
    tool: input.channel,
    target: row.id,
    result: "info",
  });
  return row;
}

export async function listMessages(
  userId: string,
  opts: { workspaceId?: string; statuses?: Message["status"][]; channel?: Message["channel"]; limit?: number } = {},
) {
  const conds: SQL[] = [
    await listScope({ userId: messages.userId, workspaceId: messages.workspaceId }, userId, opts.workspaceId),
  ];
  if (opts.statuses?.length) conds.push(inArray(messages.status, opts.statuses));
  if (opts.channel) conds.push(eq(messages.channel, opts.channel));
  return db
    .select()
    .from(messages)
    .where(and(...conds))
    .orderBy(desc(messages.receivedAt))
    .limit(opts.limit ?? 200);
}

export async function getMessage(userId: string, messageId: string) {
  const row = await db.query.messages.findFirst({ where: eq(messages.id, messageId) });
  return row && (await canAccessRow(userId, row)) ? row : undefined;
}

export async function updateMessage(userId: string, messageId: string, patch: Partial<Message>) {
  const row = await db.query.messages.findFirst({ where: eq(messages.id, messageId) });
  if (!row || !(await canAccessRow(userId, row))) return null;
  await db.update(messages).set({ ...patch, updatedAt: nowIso() }).where(eq(messages.id, messageId));
  return db.query.messages.findFirst({ where: eq(messages.id, messageId) });
}

/** Recent thread with one author on a channel — oldest first, for reply context. */
export async function conversationWith(
  channel: Message["channel"],
  authorHandle: string,
  limit = 12,
) {
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.channel, channel), eq(messages.authorHandle, authorHandle)))
    .orderBy(desc(messages.receivedAt))
    .limit(limit);
  return rows.reverse();
}

/** Owner sends a reply to a customer message (the AI draft, or an edited version). */
export async function replyToMessage(
  userId: string,
  messageId: string,
  text?: string,
): Promise<{ ok: boolean; error?: string; sent?: boolean }> {
  const row = await db.query.messages.findFirst({ where: eq(messages.id, messageId) });
  if (!row || !(await canAccessRow(userId, row))) return { ok: false, error: "not_found" };
  const body = (text ?? row.draftReply ?? "").trim();
  if (!body) return { ok: false, error: "empty" };

  const { executeAction } = await import("./action-executor");
  const r = await executeAction({
    userId,
    workspaceId: row.workspaceId,
    actionType: "reply_message",
    payload: { messageId: row.id, to: row.authorHandle, text: body, channel: row.channel },
    targetSystem: row.channel,
  });
  const sent = r.ok && r.data?.simulated !== true;
  await db
    .update(messages)
    .set({ status: sent ? "replied" : "drafted", draftReply: body, updatedAt: nowIso() })
    .where(eq(messages.id, row.id));
  return { ok: r.ok, sent, error: r.ok ? undefined : r.error };
}

/** Owner dismisses a message — no reply needed (friend / spam / handled elsewhere). */
export async function ignoreMessage(userId: string, messageId: string) {
  const row = await db.query.messages.findFirst({ where: eq(messages.id, messageId) });
  if (!row || !(await canAccessRow(userId, row))) return null;
  await db.update(messages).set({ status: "ignored", updatedAt: nowIso() }).where(eq(messages.id, row.id));
  return true;
}
