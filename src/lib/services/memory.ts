import { and, desc, eq, or, isNull, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { memories } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { nowIso } from "@/lib/utils";
import { logActivity } from "./activity";

export type Memory = typeof memories.$inferSelect;

export interface CreateMemoryInput {
  userId: string;
  workspaceId?: string | null;
  type?: Memory["type"];
  subject: string;
  content: string;
  ruleKind?: Memory["ruleKind"];
  ruleTarget?: string | null;
  importance?: Memory["importance"];
  source?: string;
  confidence?: number;
  expiresAt?: string | null;
}

export async function createMemory(input: CreateMemoryInput): Promise<Memory> {
  const row: Memory = {
    id: id("mem"),
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    type: input.type ?? "permanent",
    subject: input.subject,
    content: input.content,
    ruleKind: input.ruleKind ?? null,
    ruleTarget: input.ruleTarget ?? null,
    importance: input.importance ?? "normal",
    source: input.source ?? "user",
    confidence: input.confidence ?? 100,
    expiresAt: input.expiresAt ?? null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.insert(memories).values(row);
  await logActivity({
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    action: `נשמר לזיכרון (${row.type}): ${input.subject}`,
    tool: "memory",
    target: row.id,
    result: "success",
  });
  return row;
}

export async function listMemories(
  userId: string,
  opts: { workspaceId?: string; types?: Memory["type"][] } = {},
) {
  const conds = [eq(memories.userId, userId)];
  if (opts.types?.length) conds.push(inArray(memories.type, opts.types));
  if (opts.workspaceId)
    conds.push(or(isNull(memories.workspaceId), eq(memories.workspaceId, opts.workspaceId))!);
  return db
    .select()
    .from(memories)
    .where(and(...conds))
    .orderBy(desc(memories.importance), desc(memories.updatedAt));
}

export async function deleteMemory(userId: string, memId: string) {
  await db.delete(memories).where(and(eq(memories.id, memId), eq(memories.userId, userId)));
}

/** Compact context block injected into the orchestrator's system prompt. */
export async function memoryContext(userId: string, workspaceId: string | null): Promise<string> {
  const rows = await listMemories(userId, {
    workspaceId: workspaceId ?? undefined,
    types: ["permanent", "knowledge"],
  });
  if (!rows.length) return "";
  const lines = rows
    .slice(0, 40)
    .map((m) => `- [${m.type}${m.ruleKind ? `/${m.ruleKind}` : ""}] ${m.subject}: ${m.content}`);
  return `זיכרון קבוע וכללים של המשתמשת:\n${lines.join("\n")}`;
}
