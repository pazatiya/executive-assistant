import { CalendarClock, Plug } from "lucide-react";
import { PageHeader, PageBody } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { RemindersPanel } from "@/components/calendar/reminders-panel";
import { loadAppContext } from "@/lib/app-context";
import { listReminders } from "@/lib/services/reminders";
import { getConnector } from "@/lib/integrations/registry";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const { user, activeWorkspace } = await loadAppContext();
  const [reminders, gcal] = await Promise.all([
    listReminders(user.id, {}),
    getConnector(user.id, "google_calendar", null),
  ]);

  return (
    <>
      <PageHeader
        title="יומן ותזכורות"
        description="מנוע התזכורות פעיל (חד-פעמי / חוזר / follow-up / דדליין / תנאי). אירועי יומן יסונכרנו כשיחובר Google Calendar."
      />
      <PageBody className="space-y-5">
        {gcal?.status !== "connected" && (
          <Card className="flex items-center gap-3 border-dashed p-4 text-sm">
            <Plug className="size-5 text-muted-foreground" />
            <div className="flex-1">
              <span className="font-medium">Google Calendar — לא מחובר.</span>{" "}
              <span className="text-muted-foreground">
                בדיקת זמינות, הצעת חלונות ויצירת אירועים יופעלו לאחר חיבור.
              </span>
            </div>
            <a href="/integrations" className="rounded-lg border px-3 py-1.5 text-xs">
              חיבור
            </a>
          </Card>
        )}

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarClock className="size-4" /> אזור זמן: Asia/Jerusalem · workspace: {activeWorkspace.name}
        </div>

        <RemindersPanel initial={reminders} />
      </PageBody>
    </>
  );
}
