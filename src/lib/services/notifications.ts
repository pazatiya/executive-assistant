/**
 * Central notification service. Every alert the owners should see goes through
 * `notify()` — it writes the in-app row (the bell + list) AND fires a push to
 * the user's phone. Replaces the retired WhatsApp owner channel.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications, workspaceMembers } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { sendPushToUser } from "./push";

type Kind = typeof notifications.$inferSelect["kind"];
type Priority = typeof notifications.$inferSelect["priority"];

export interface NotifyInput {
  userId: string;
  workspaceId?: string | null;
  kind?: Kind;
  title: string;
  body?: string;
  href?: string;
  priority?: Priority;
}

/** One owner: in-app row + push. */
export async function notify(input: NotifyInput): Promise<void> {
  await db.insert(notifications).values({
    id: id("ntf"),
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    kind: input.kind ?? "info",
    title: input.title,
    body: input.body ?? "",
    href: input.href ?? null,
    priority: input.priority ?? "normal",
  });
  await sendPushToUser(input.userId, {
    title: input.title,
    body: input.body ?? "",
    href: input.href,
    tag: input.kind,
  }).catch(() => {});
}

/** Every member of a workspace (the owners) gets the notification. */
export async function notifyWorkspace(
  workspaceId: string,
  input: Omit<NotifyInput, "userId" | "workspaceId">,
): Promise<void> {
  const members = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId));
  await Promise.all(
    members.map((m) => notify({ ...input, userId: m.userId, workspaceId }).catch(() => {})),
  );
}

/** A specific user only if they belong to the workspace (falls back to user). */
export async function notifyOwnersOf(
  workspaceId: string | null,
  input: Omit<NotifyInput, "userId" | "workspaceId"> & { fallbackUserId: string },
): Promise<void> {
  if (workspaceId) {
    const member = await db.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, input.fallbackUserId),
      ),
    });
    if (member) return notifyWorkspace(workspaceId, input);
  }
  return notify({ ...input, userId: input.fallbackUserId, workspaceId });
}
