import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { approvals, notifications, tasks } from "@/lib/db/schema";
import { getActiveWorkspaceId, getCurrentUser } from "@/lib/auth";
import { listWorkspaces } from "@/lib/services/workspaces";

export async function loadAppContext() {
  const user = await getCurrentUser();
  const workspaces = await listWorkspaces(user.id);
  const activeWorkspaceId = await getActiveWorkspaceId(user.id);
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];

  const [pendingApprovals, openTasks, unreadNotifs] = await Promise.all([
    db
      .select({ id: approvals.id })
      .from(approvals)
      .where(and(eq(approvals.userId, user.id), eq(approvals.status, "pending"))),
    db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, user.id),
          inArray(tasks.status, ["inbox", "planned", "in_progress", "waiting", "waiting_approval"]),
        ),
      ),
    db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt))),
  ]);

  return {
    user,
    workspaces,
    activeWorkspace,
    counts: {
      approvals: pendingApprovals.length,
      tasks: openTasks.length,
      notifications: unreadNotifs.length,
    },
  };
}
