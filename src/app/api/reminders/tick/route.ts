import { timingSafeEqual } from "node:crypto";
import { ok } from "@/lib/api";
import { env } from "@/lib/env";
import { processDueReminders } from "@/lib/services/reminders";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const expected = env.cronSecret;
  if (!expected) return false; // fail closed
  const url = new URL(req.url);
  const provided =
    url.searchParams.get("secret") ??
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Legacy endpoint — the canonical heartbeat is /api/scheduler/tick. Kept for
// existing cron config; now requires CRON_SECRET.
export async function POST(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const fired = await processDueReminders();
  return ok({ fired: fired.length, ids: fired.map((f) => f.id) });
}
