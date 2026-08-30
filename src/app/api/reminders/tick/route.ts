import { ok } from "@/lib/api";
import { processDueReminders } from "@/lib/services/reminders";

export const dynamic = "force-dynamic";

// External scheduler hits this every few minutes (no auth in dev; add a shared
// secret header check before deploying).
export async function POST() {
  const fired = await processDueReminders();
  return ok({ fired: fired.length, ids: fired.map((f) => f.id) });
}
