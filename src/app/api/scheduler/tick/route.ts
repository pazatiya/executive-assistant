import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { processDueReminders } from "@/lib/services/reminders";
import { runDueBriefs } from "@/lib/services/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

/**
 * The single heartbeat. Render's cron hits this every ~5 minutes.
 * Runs: due reminders + owner briefs (morning / midday / evening).
 */
export async function POST(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });

  const [reminders, briefs] = await Promise.all([
    processDueReminders().catch((e) => ({ error: String(e) })),
    runDueBriefs().catch((e) => ({ error: String(e) })),
  ]);

  return Response.json({
    ok: true,
    at: new Date().toISOString(),
    reminders: Array.isArray(reminders) ? reminders.length : reminders,
    briefs: Array.isArray(briefs) ? briefs.filter((b) => b.outcome !== "not_due") : briefs,
  });
}

export async function GET(req: Request) {
  // allow GET too (some cron providers only do GET)
  return POST(req);
}
