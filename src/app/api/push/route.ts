import { apiContext, bad, ok, readJson } from "@/lib/api";
import { env } from "@/lib/env";
import { pushEnabled, removeSubscription, saveSubscription } from "@/lib/services/push";

export const dynamic = "force-dynamic";

/** GET → the VAPID public key (or null if push isn't configured). */
export async function GET() {
  return ok({ enabled: pushEnabled(), key: env.vapidPublic || null });
}

/** POST → register (or refresh) this device's push subscription. */
export async function POST(req: Request) {
  const { user } = await apiContext();
  const body = await readJson<{
    subscription?: { endpoint: string; keys: { p256dh: string; auth: string } };
  }>(req);
  const sub = body.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return bad("subscription לא תקין");
  await saveSubscription(user.id, sub, req.headers.get("user-agent") ?? undefined);
  return ok({ saved: true });
}

/** DELETE → drop this device's subscription. */
export async function DELETE(req: Request) {
  await apiContext();
  const body = await readJson<{ endpoint?: string }>(req);
  if (body.endpoint) await removeSubscription(body.endpoint);
  return ok({ removed: true });
}
