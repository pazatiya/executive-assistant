import { CalendarDays, Scissors, Bell, Plug } from "lucide-react";
import { PageHeader, PageBody } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { loadAppContext } from "@/lib/app-context";
import { listReminders } from "@/lib/services/reminders";
import { getConnector } from "@/lib/integrations/registry";
import { listAppointments, type AdminAppointment } from "@/lib/integrations/dalor-barber";

export const dynamic = "force-dynamic";

const HE_DOW = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const TZ = "Asia/Jerusalem";

function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dayLabel(iso: string): string {
  const t = todayISO();
  if (iso === t) return "היום";
  if (iso === addDays(t, 1)) return "מחר";
  const d = new Date(`${iso}T12:00:00Z`);
  return `${HE_DOW[d.getUTCDay()]} · ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

type Item =
  | { kind: "appointment"; time: string; title: string; sub: string }
  | { kind: "reminder"; time: string | null; title: string; sub: string };

export default async function CalendarPage() {
  const { user, activeWorkspace } = await loadAppContext();
  const from = todayISO();
  const to = addDays(from, 13);

  const barber = await getConnector(user.id, "dalor_barber", null);
  const [reminders, appts] = await Promise.all([
    listReminders(user.id, { statuses: ["scheduled"] }),
    barber?.status === "connected"
      ? listAppointments({ from, to }).catch(() => [] as AdminAppointment[])
      : Promise.resolve([] as AdminAppointment[]),
  ]);

  // bucket by day
  const days: Record<string, Item[]> = {};
  const push = (date: string, item: Item) => {
    if (date < from || date > to) return;
    (days[date] ??= []).push(item);
  };

  for (const a of appts) {
    push(a.date, {
      kind: "appointment",
      time: a.time,
      title: a.fullName || "תור",
      sub: `${a.phone}${a.notes ? ` · ${a.notes}` : ""}`,
    });
  }
  for (const r of reminders) {
    const iso = r.dueAt.slice(0, 10);
    const time = r.dueAt.length > 10 ? new Date(r.dueAt).toLocaleTimeString("he-IL", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }) : null;
    push(iso, { kind: "reminder", time, title: r.title, sub: r.description || r.kind });
  }

  const dates = Object.keys(days).sort();
  for (const d of dates) days[d].sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99"));

  const totalAppts = appts.length;

  return (
    <>
      <PageHeader title="יומן" description={`תורים במספרה ותזכורות — 14 הימים הקרובים · ${activeWorkspace?.name ?? ""}`}>
        <span className="rounded-lg risk-yellow px-2.5 py-1 text-xs font-medium">{totalAppts} תורים</span>
      </PageHeader>

      <PageBody className="space-y-4">
        {barber?.status !== "connected" && (
          <Card className="flex items-center gap-3 border-dashed p-4 text-sm">
            <Plug className="size-5 text-muted-foreground" />
            <span className="flex-1 text-muted-foreground">אפליקציית התורים לא מחוברת — מוצגות רק תזכורות.</span>
            <a href="/integrations" className="rounded-lg border px-3 py-1.5 text-xs">חיבור</a>
          </Card>
        )}

        {dates.length === 0 && (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            <CalendarDays className="mx-auto mb-2 size-6 opacity-50" />
            אין תורים או תזכורות בשבועיים הקרובים.
          </div>
        )}

        {dates.map((date) => (
          <section key={date}>
            <h2 className="mb-1.5 text-sm font-semibold">{dayLabel(date)}</h2>
            <div className="divide-y overflow-hidden rounded-xl border">
              {days[date].map((it, i) => (
                <div key={i} className="flex items-center gap-3 p-3">
                  <div className="w-12 shrink-0 text-center">
                    <div className="text-sm font-semibold tabular-nums">{it.time ?? "—"}</div>
                  </div>
                  <div
                    className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
                      it.kind === "appointment" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {it.kind === "appointment" ? <Scissors className="size-4" /> : <Bell className="size-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{it.title}</div>
                    <div className="truncate text-xs text-muted-foreground" dir="ltr">
                      {it.sub}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </PageBody>
    </>
  );
}
