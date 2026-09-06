import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workspaceMembers, workspaces } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { nowIso } from "@/lib/utils";
import { env } from "@/lib/env";
import { isMember } from "@/lib/auth/scope";

export type Workspace = typeof workspaces.$inferSelect;

/** Workspaces this user is a member of (owned or shared), oldest first. */
export async function listWorkspaces(userId: string) {
  const rows = await db
    .select()
    .from(workspaces)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaces.isArchived, false)))
    .orderBy(asc(workspaces.createdAt));
  return rows.map((r) => r.workspaces);
}

export async function getWorkspace(userId: string, workspaceId: string) {
  if (!(await isMember(userId, workspaceId))) return undefined;
  return db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
}

export interface CreateWorkspaceInput {
  userId: string;
  name: string;
  type?: Workspace["type"];
  description?: string;
  color?: string;
  icon?: string;
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  const slug = input.name
    .toLowerCase()
    .replace(/[^a-z0-9֐-׿]+/g, "-")
    .replace(/(^-|-$)/g, "") || id("ws").slice(3);
  const row: Workspace = {
    id: id("ws"),
    ownerId: input.userId,
    name: input.name,
    slug,
    type: input.type ?? "business",
    description: input.description ?? "",
    color: input.color ?? "#6366f1",
    icon: input.icon ?? "briefcase",
    brandVoice: {},
    settings: {},
    isArchived: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.insert(workspaces).values(row);
  await db.insert(workspaceMembers).values({
    id: id("wm"),
    workspaceId: row.id,
    userId: input.userId,
    role: "owner",
  });
  return row;
}

export async function updateWorkspace(userId: string, workspaceId: string, patch: Partial<Workspace>) {
  const ws = await getWorkspace(userId, workspaceId);
  if (!ws) return null;
  await db.update(workspaces).set({ ...patch, updatedAt: nowIso() }).where(eq(workspaces.id, workspaceId));
  return db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
}

export type AssistantMode = "draft_only" | "active";

/**
 * Autonomy for a workspace's assistant.
 *  - draft_only: the assistant NEVER sends a customer message on its own —
 *    every reply is a draft the owner sends from the app.
 *  - active: whitelisted routine answers (hours / address / pricelist /
 *    availability) send automatically; everything else still drafts.
 */
export async function getAssistantMode(workspaceId: string | null): Promise<AssistantMode> {
  if (!workspaceId) return env.assistantModeDefault;
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
  const s = (ws?.settings ?? {}) as { assistantMode?: AssistantMode };
  return s.assistantMode === "active" || s.assistantMode === "draft_only"
    ? s.assistantMode
    : env.assistantModeDefault;
}

export async function setAssistantMode(userId: string, workspaceId: string, mode: AssistantMode) {
  const ws = await getWorkspace(userId, workspaceId);
  if (!ws) return null;
  const settings = { ...(ws.settings as Record<string, unknown>), assistantMode: mode };
  await db.update(workspaces).set({ settings, updatedAt: nowIso() }).where(eq(workspaces.id, workspaceId));
  return mode;
}
