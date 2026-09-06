/**
 * Web Push (VAPID) delivery. Sends a browser/phone notification to every device
 * a user has subscribed. Dead subscriptions are pruned automatically.
 */
import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { id } from "@/lib/ids";

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  if (!env.vapidPublic || !env.vapidPrivate) return false;
  webpush.setVapidDetails(env.vapidSubject, env.vapidPublic, env.vapidPrivate);
  configured = true;
  return true;
}

export function pushEnabled(): boolean {
  return Boolean(env.vapidPublic && env.vapidPrivate);
}

export interface PushPayload {
  title: string;
  body: string;
  href?: string;
  tag?: string;
}

export async function saveSubscription(
  userId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent?: string,
): Promise<void> {
  const existing = await db.query.pushSubscriptions.findFirst({
    where: eq(pushSubscriptions.endpoint, sub.endpoint),
  });
  if (existing) {
    await db
      .update(pushSubscriptions)
      .set({ userId, keys: sub.keys, userAgent: userAgent ?? null, updatedAt: new Date().toISOString() })
      .where(eq(pushSubscriptions.id, existing.id));
    return;
  }
  await db.insert(pushSubscriptions).values({
    id: id("push"),
    userId,
    endpoint: sub.endpoint,
    keys: sub.keys,
    userAgent: userAgent ?? null,
  });
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

/** Push to all of a user's devices. Best-effort; never throws. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<{ sent: number; pruned: number }> {
  if (!ensureConfigured()) return { sent: 0, pruned: 0 };
  const subs = await db.query.pushSubscriptions.findMany({ where: eq(pushSubscriptions.userId, userId) });
  let sent = 0;
  let pruned = 0;
  const data = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, data);
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id)).catch(() => {});
          pruned++;
        }
      }
    }),
  );
  return { sent, pruned };
}
