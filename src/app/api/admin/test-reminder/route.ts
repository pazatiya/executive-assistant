import { apiContext } from "@/lib/api";
import { createReminder, processDueReminders } from "@/lib/services/reminders";

export const dynamic = "force-dynamic";

/** One-off: creates a reminder due right now and fires it immediately, to
 * prove the in-app + WhatsApp (template or fallback) pipeline end-to-end
 * without waiting for the next 5-min cron tick. Delete after use. */
export async function GET(req: Request) {
  const { user, workspaceId } = await apiContext(req);
  await createReminder({
    userId: user.id,
    workspaceId,
    title: "לשבת על האתר של גילי",
    dueAt: new Date().toISOString(),
    kind: "one_time",
  });
  const fired = await processDueReminders();
  return Response.json({ ok: true, fired: fired.length });
}
