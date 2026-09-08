import Link from "next/link";
import {
  ArrowLeft,
  BellRing,
  CalendarPlus,
  CheckCircle2,
  CheckSquare,
  FileUp,
  Mail,
  MessageSquarePlus,
  ShieldCheck,
  Sparkles,
  Users2,
  Zap,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RiskBadge } from "@/components/shared/labels";
import { loadAppContext } from "@/lib/app-context";
import { buildMorningBrief } from "@/lib/services/brief";
import { listActivity } from "@/lib/services/activity";
import { listApprovals } from "@/lib/services/approvals";
import { timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

function getGreeting() {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "2-digit", hour12: false, timeZone: "Asia/Jerusalem" }).format(new Date()),
  );
  if (hour < 12) return "בוקר טוב";
  if (hour < 17) return "צהריים טובים";
  return "ערב טוב";
}

export default async function DashboardPage() {
  const { user } = await loadAppContext();
  const [brief, activity, approvals] = await Promise.all([
    buildMorningBrief(user.id),
    listActivity(user.id, { limit: 8 }),
    listApprovals(user.id, { statuses: ["pending"], limit: 5 }),
  ]);

  const stat = [
    {
      label: "משימות פתוחות",
      value: brief.openTasks.length,
      href: "/tasks",
      icon: CheckSquare,
      tone: "bg-violet-50 text-violet-600",
      hint: brief.openTasks.length ? "ממתינות לטיפול" : "הכול מסודר",
    },
    {
      label: "אישורים ממתינים",
      value: brief.waitingApprovals.length,
      href: "/approvals",
      icon: ShieldCheck,
      tone: "bg-amber-50 text-amber-600",
      hint: brief.waitingApprovals.length ? "דורשים החלטה" : "אין מה לאשר",
    },
    {
      label: "מיילים חשובים",
      value: brief.importantEmails.length,
      href: "/messages",
      icon: Mail,
      tone: "bg-sky-50 text-sky-600",
      hint: brief.importantEmails.length ? "כדאי לעבור עליהם" : "תיבת הדואר נקייה",
    },
    {
      label: "לידים חדשים",
      value: brief.newLeads.length,
      href: "/messages",
      icon: Users2,
      tone: "bg-emerald-50 text-emerald-600",
      hint: brief.newLeads.length ? "מחכים למענה" : "אין לידים חדשים",
    },
  ];

  const dateLabel = new Intl.DateTimeFormat("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Jerusalem",
  }).format(new Date());

  const quickActions = [
    { label: "שיחה עם המזכירה", description: "בקשה חדשה או טיפול בנושא", href: "/assistant", icon: MessageSquarePlus },
    { label: "הוספת משימה", description: "משהו שצריך לקדם", href: "/tasks", icon: CheckSquare },
    { label: "יצירת תזכורת", description: "לא לשכוח את הדבר הבא", href: "/calendar", icon: CalendarPlus },
    { label: "טיפול במסמך", description: "העלאה, סיכום וחילוץ משימות", href: "/documents", icon: FileUp },
  ];

  return (
    <>
      <PageHeader
        title={`${getGreeting()}, ${user.fullName || "פז"}`}
        description={`${dateLabel} · הנה תמונת המצב והדברים שכדאי לקדם עכשיו`}
      >
        <Link
          href="/assistant"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:-translate-y-0.5 hover:bg-primary/90 sm:w-auto"
        >
          <Sparkles className="size-4" /> משימה חדשה למזכירה
        </Link>
      </PageHeader>

      <PageBody className="space-y-5 sm:space-y-6">
        <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="תמונת מצב">
          {stat.map((s) => (
            <Link key={s.label} href={s.href} className="group min-w-0">
              <Card className="h-full overflow-hidden transition-all hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-lg">
                <CardContent className="relative flex h-full min-h-[126px] flex-col justify-between p-4 sm:min-h-[138px] sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl sm:size-11 ${s.tone}`}>
                      <s.icon className="size-5" />
                    </div>
                    <ArrowLeft className="size-4 -translate-x-1 text-muted-foreground/40 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                  </div>
                  <div className="mt-3 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-bold tracking-tight sm:text-[2.15rem]">{s.value}</span>
                      <span className="truncate text-xs font-semibold text-foreground/75 sm:text-sm">{s.label}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground sm:text-xs">{s.hint}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </section>

        <section className="grid gap-5 sm:gap-6 lg:grid-cols-12">
          <Card className="overflow-hidden lg:col-span-8">
            <CardHeader className="flex-row items-center justify-between border-b border-border/70">
              <div>
                <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-primary">
                  <Zap className="size-3.5" /> תדריך יומי
                </div>
                <CardTitle className="text-lg">מה חשוב היום</CardTitle>
              </div>
              <Link href="/brief" className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                לתדריך המלא <ArrowLeft className="size-3.5" />
              </Link>
            </CardHeader>
            <CardContent className="space-y-5 pt-5 sm:pt-6">
              {brief.urgent.length > 0 && (
                <div className="risk-red rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2 font-bold"><BellRing className="size-4" /> דחוף לטיפול</div>
                  <ul className="mt-2 list-disc space-y-1 pr-5 text-sm">
                    {brief.urgent.map((u) => <li key={u}>{u}</li>)}
                  </ul>
                </div>
              )}

              <div>
                <div className="mb-3 text-sm font-bold">סדר עדיפויות מוצע</div>
                <div className="space-y-2.5">
                  {brief.suggestedOrder.length ? (
                    brief.suggestedOrder.slice(0, 4).map((item, index) => (
                      <div key={item} className="flex items-start gap-3 rounded-xl bg-secondary/55 px-3.5 py-3 text-sm">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-card text-xs font-bold text-primary shadow-sm">{index + 1}</span>
                        <span className="pt-0.5 leading-relaxed">{item}</span>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                      <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
                      אין כרגע משימות דחופות — אפשר להתמקד במה שמקדם אותך.
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-3 border-t pt-5 sm:grid-cols-2">
                <BriefList title="משימות באיחור" items={brief.overdueTasks.map((t) => t.title)} empty="אין משימות באיחור" />
                <BriefList title="לידים חדשים" items={brief.newLeads.map((l) => `${l.who} · ${l.source}`)} empty="אין לידים חדשים" />
                <BriefList title="מיילים חשובים" items={brief.importantEmails.map((e) => `${e.from}: ${e.subject}`)} empty="אין מיילים שמחכים לטיפול" />
                <BriefList title="אישורים ממתינים" items={brief.waitingApprovals.map((a) => a.title)} empty="אין אישורים ממתינים" />
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-4">
            <CardHeader>
              <CardTitle className="text-lg">פעולות מהירות</CardTitle>
              <p className="text-xs text-muted-foreground">קיצורי דרך לדברים שעושים הכי הרבה</p>
            </CardHeader>
            <CardContent className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
              {quickActions.map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="group flex min-h-[66px] items-center gap-3 rounded-xl border border-transparent bg-secondary/55 px-3.5 py-3 transition-all hover:border-primary/15 hover:bg-primary/[0.045]"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-card text-primary shadow-sm">
                    <action.icon className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">{action.label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{action.description}</span>
                  </span>
                  <ArrowLeft className="size-4 text-muted-foreground/50 transition-transform group-hover:-translate-x-0.5 group-hover:text-primary" />
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card className="lg:col-span-5">
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>אישורים ממתינים</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">פעולות שמחכות להחלטה שלך</p>
              </div>
              <Link href="/approvals" className="text-xs font-semibold text-primary hover:underline">הצגת הכל</Link>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {approvals.length === 0 && (
                <div className="flex min-h-28 flex-col items-center justify-center rounded-xl border border-dashed bg-secondary/25 p-5 text-center">
                  <CheckCircle2 className="mb-2 size-6 text-emerald-500" />
                  <p className="text-sm font-semibold">אין אישורים שמחכים לך</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">כל הפעולות מעודכנות</p>
                </div>
              )}
              {approvals.map((a) => (
                <Link key={a.id} href="/approvals" className="block rounded-xl border p-3.5 text-sm transition-all hover:border-primary/25 hover:bg-primary/[0.025]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 font-bold">{a.title}</span>
                    <RiskBadge level={a.riskLevel} />
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{a.reason}</p>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card className="lg:col-span-7">
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>פעילות אחרונה</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">מה המזכירה והמערכת עשו לאחרונה</p>
              </div>
              <Link href="/activity" className="text-xs font-semibold text-primary hover:underline">מרכז הפעילות</Link>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-border/70">
                {activity.slice(0, 6).map((a) => (
                  <div key={a.id} className="flex min-h-[48px] items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className={`size-2 shrink-0 rounded-full ${a.result === "failure" ? "bg-destructive" : a.result === "waiting" ? "bg-warning" : "bg-success"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 text-sm font-medium">{a.action}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{a.agent} · {timeAgo(a.createdAt)}</p>
                    </div>
                  </div>
                ))}
                {activity.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">עדיין אין פעילות להצגה</p>}
              </div>
            </CardContent>
          </Card>
        </section>
      </PageBody>
    </>
  );
}

function BriefList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-xl border border-border/70 px-3.5 py-3">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-xs font-bold">{title}</span>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{items.length}</span>
      </div>
      {items.length ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {items.slice(0, 3).map((t, i) => <li key={i} className="line-clamp-1">• {t}</li>)}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}
