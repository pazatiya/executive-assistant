/**
 * Multi-owner row scoping.
 *
 * Every domain row carries both `userId` (who created it) and `workspaceId`.
 * Visibility is decided by **workspace membership**, not by the creator:
 *
 *  - A workspace you are a member of  → you see every row in it (shared).
 *    Personal workspaces simply have one member, so "every row in it" == "my rows".
 *  - A cross-workspace list (no workspaceId) → your own rows, plus every row in
 *    any workspace you are a member of. Account-level rows (workspaceId = null)
 *    stay private to their creator.
 *
 * This keeps DALOR shared between פז and יאיר while each personal workspace
 * stays private, with no per-service privacy logic.
 */
import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { db } from "@/lib/db";
import { workspaceMembers, workspaces } from "@/lib/db/schema";

type ScopeCols = { userId: AnySQLiteColumn; workspaceId: AnySQLiteColumn };

const memberCache = new Map<string, boolean>();

/** Is this user a member of this workspace? (request-lifetime memoised) */
export async function isMember(userId: string, workspaceId: string): Promise<boolean> {
  const key = `${userId}:${workspaceId}`;
  const hit = memberCache.get(key);
  if (hit !== undefined) return hit;
  const row = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)),
  });
  const ok = Boolean(row);
  memberCache.set(key, ok);
  return ok;
}

/** All workspace ids this user is a member of. */
export async function myWorkspaceIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
  return rows.map((r) => r.id);
}

/**
 * Build the WHERE condition for a "list" query over a scoped table.
 * Pass the table's `userId` / `workspaceId` columns and (optionally) the
 * workspace the caller is scoped to.
 */
export async function listScope(
  cols: ScopeCols,
  userId: string,
  workspaceId?: string | null,
): Promise<SQL> {
  if (workspaceId) {
    if (await isMember(userId, workspaceId)) return eq(cols.workspaceId, workspaceId);
    // not a member — never widen; fall back to strict ownership
    return and(eq(cols.userId, userId), eq(cols.workspaceId, workspaceId))!;
  }
  const wsIds = await myWorkspaceIds(userId);
  return wsIds.length
    ? or(eq(cols.userId, userId), inArray(cols.workspaceId, wsIds))!
    : eq(cols.userId, userId);
}

/** Can this user read / act on an already-fetched row? */
export async function canAccessRow(
  userId: string,
  row: { userId: string; workspaceId: string | null } | null | undefined,
): Promise<boolean> {
  if (!row) return false;
  if (row.userId === userId) return true;
  if (row.workspaceId && (await isMember(userId, row.workspaceId))) return true;
  return false;
}

/** The first workspace this user belongs to (creation order), or null. */
export async function firstWorkspaceForUser(userId: string): Promise<string | null> {
  const rows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaces.isArchived, false)))
    .orderBy(workspaces.createdAt)
    .limit(1);
  return rows[0]?.id ?? null;
}
