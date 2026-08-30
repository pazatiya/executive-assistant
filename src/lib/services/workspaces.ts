import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workspaceMembers, workspaces } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { nowIso } from "@/lib/utils";

export type Workspace = typeof workspaces.$inferSelect;

export async function listWorkspaces(userId: string) {
  return db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.ownerId, userId), eq(workspaces.isArchived, false)))
    .orderBy(asc(workspaces.createdAt));
}

export async function getWorkspace(userId: string, workspaceId: string) {
  return db.query.workspaces.findFirst({
    where: and(eq(workspaces.id, workspaceId), eq(workspaces.ownerId, userId)),
  });
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
