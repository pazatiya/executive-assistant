import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  BellRing,
  CalendarPlus,
  Check,
  CheckCircle2,
  CheckSquare,
  Clock3,
  FileUp,
  Mail,
  MessageSquarePlus,
  ShieldCheck,
  Sparkles,
  Users2,
  Zap,
} from "lucide-react";
import { PageBody } from "@/components/layout/page-header";
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

  const stats = [
    { label: "משימות פתוחות", value: brief.openTasks.length, href: "/tasks", icon: CheckSquare, tone: "violet", hint: brief.openTasks.length ? "ממתינות לקידום" : "הכול מסודר" },
    { label: "אישורים", value: brief.waitingApprovals.length, href: "/approvals", icon: ShieldCheck, tone: "gold", hint: brief.waitingApprovals.length ? "דורשים החלטה" : "אין מה לאשר" },
    { label: "הודעות חשובות", value: brief.importantEmails.length, href: "/messages", icon: Mail, tone: "blue", hint: brief.importantEmails.length ? "כדאי לעבור עליהן" : "תיבת הדואר נקייה" },
    { label: "לידים חדשים", value: brief.newLeads.length, href: "/messages", icon: Users2, tone: "sage", hint: brief.newLeads.length ? "מחכים למענה" : "אין לידים חדשים" },
  ];

  const quickActions = [
    { label: "משימה חדשה", href: "/tasks", icon: CheckSquare },
    { label: "יצירת תזכורת", href: "/calendar", icon: CalendarPlus },
    { label: "טיפול במסמך", href: "/documents", icon: FileUp },
    { label: "שיחה עם המזכירה", href: "/assistant", icon: MessageSquarePlus },
  ];

  const dateLabel = new Intl.DateTimeFormat("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Jerusalem",
  }).format(new Date());

  const primaryFocus = brief.urgent[0] ?? brief.suggestedOrder[0] ?? "לבחור את המהלך המרכזי הבא שלך";
  const focusSteps = [
    { label: brief.newLeads.length ? `לחזור ל-${brief.newLeads.length} לידים חדשים` : "בדיקת לידים הושלמה", done: brief.newLeads.length === 0 },
    { label: brief.importantEmails.length ? `לענות ל-${brief.importantEmails.length} הודעות חשובות` : "ההודעות החשובות טופלו", done: brief.importantEmails.length === 0 },
    { label: brief.openTasks.length ? `לקדם ${brief.openTasks.length} משימות פתוחות` : "אין משימות שמחכות לקידום", done: brief.openTasks.length === 0 },
  ];

  const flow = brief.suggestedOrder.length
    ? brief.suggestedOrder.slice(0, 4).map((label, index) => ({ label, note: index === 0 ? "המיקוד הבא" : `שלב ${index + 1}`, active: index === 0, done: false }))
    : [
        { label: "סקירת הבוקר הושלמה", note: "בוצע", active: false, done: true },
        { label: "אין משימות דחופות", note: "המצב בשליטה", active: true, done: false },
        { label: "בחירת יעד מרכזי", note: "אפשר לתכנן עם המזכירה", active: false, done: false },
      ];

  return (
    <PageBody className="space-y-4 pb-12 pt-4 sm:space-y-5 sm:pt-6">
      <section className="dashboard-hero" aria-labelledby="dashboard-greeting">
        <div className="dashboard-hero-wash" />
        <Image
          src="/visuals/ai-secretary-mascot.webp"
          alt="מזכירת AI לא אנושית מסדרת משימות"
          width={1214}
          height={1295}
          priority
          className="dashboard-mascot"
        />
        <div className="relative z-10 flex h-full max-w-[640px] flex-col justify-end px-5 pb-6 pt-28 sm:px-9 sm:pb-8 sm:pt-8 lg:justify-center lg:py-8">
          <div className="editorial-kicker"><span /> {dateLabel}</div>
          <h1 id="dashboard-greeting" className="mt-2 text-[2.3rem] font-extrabold leading-[0.95] tracking-[-0.055em] text-[#17162b] sm:text-5xl lg:text-[3.45rem]">
            {getGreeting()}, {user.fullName || "פז"}
          </h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-[#5f5b6d] sm:text-base">
            המזכירה ארגנה את תמונת המצב. נשאר לבחור במה מתמקדים עכשיו.
          </p>
          <Link href="/assistant" className="mt-5 inline-flex h-11 w-fit items-center gap-2 rounded-xl bg-[#17162b] px-5 text-sm font-bold text-white shadow-lg shadow-[#17162b]/15 transition hover:-translate-y-0.5 hover:bg-[#292644]">
            <Sparkles className="size-4 text-[#e7bd5b]" /> דברו עם המזכירה <ArrowLeft className="size-4" />
          </Link>
        </div>
      </section>

      <section className="metrics-ribbon" aria-label="תמונת מצב">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href} className="metric-module group">
            <span className={`metric-icon metric-icon-${stat.tone}`}><stat.icon className="size-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <strong className="text-3xl leading-none tracking-[-0.04em]">{stat.value}</strong>
                <span className="truncate text-sm font-bold">{stat.label}</span>
              </span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">{stat.hint}</span>
            </span>
            <ArrowLeft className="size-4 text-muted-foreground/35 transition group-hover:-translate-x-0.5 group-hover:text-primary" />
          </Link>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-12">
        <div className="focus-panel lg:col-span-8">
          <div className="decision-ribbons" aria-hidden="true"><i /><i /><i /><i /></div>
          <div className="relative z-10 flex h-full flex-col p-5 sm:p-7 lg:mr-auto lg:w-[70%]">
            <div className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-2 text-xs font-bold text-[#e7bd5b]"><Zap className="size-4" /> המהלך הבא</span>
              <span className="rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/55">לפי התדריך היומי</span>
            </div>

            <h2 className="mt-6 text-2xl font-extrabold leading-tight tracking-[-0.035em] text-white sm:text-[2rem]">{primaryFocus}</h2>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-white/50">
              <span className="flex items-center gap-1.5"><Clock3 className="size-3.5" /> עכשיו</span>
              <span>{brief.openTasks.length} משימות פתוחות</span>
              <span>{brief.waitingApprovals.length} אישורים</span>
            </div>

            <div className="mt-6 space-y-2 rounded-2xl border border-white/10 bg-black/10 p-3 backdrop-blur-sm">
              {focusSteps.map((step) => (
                <div key={step.label} className="flex items-center gap-2.5 border-b border-white/[0.07] py-2 text-sm text-white/80 last:border-0">
                  <span className={`flex size-5 shrink-0 items-center justify-center rounded-full ${step.done ? "bg-[#6fba91] text-white" : "border border-white/35 text-transparent"}`}>
                    <Check className="size-3" />
                  </span>
                  <span className={step.done ? "text-white/45 line-through" : ""}>{step.label}</span>
                </div>
              ))}
            </div>

            <div className="mt-auto flex flex-col gap-3 pt-6 sm:flex-row sm:items-center">
              <Link href="/assistant" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-[#d3a845] to-[#f0cf77] px-5 text-sm font-extrabold text-[#29200c] shadow-lg shadow-black/20 transition hover:-translate-y-0.5">
                לפתוח עם המזכירה <ArrowLeft className="size-4" />
              </Link>
              <Link href="/brief" className="text-center text-xs font-semibold text-white/55 transition hover:text-white">לתדריך המלא</Link>
            </div>
          </div>
        </div>

        <Card className="timeline-card overflow-hidden lg:col-span-4">
          <CardHeader className="flex-row items-center justify-between pb-3 sm:pb-3">
            <div>
              <div className="editorial-kicker"><span /> סדר היום</div>
              <CardTitle className="mt-1 text-xl">ציר המיקוד שלך</CardTitle>
            </div>
            <Link href="/brief" className="text-xs font-bold text-primary">הכול <ArrowLeft className="mr-1 inline size-3" /></Link>
          </CardHeader>
          <CardContent>
            <div className="focus-flow">
              {flow.map((item, index) => (
                <div key={`${item.label}-${index}`} className={`focus-flow-item ${item.active ? "is-active" : ""}`}>
                  <span className={`focus-flow-node ${item.done ? "is-done" : item.active ? "is-current" : ""}`}>{item.done && <Check className="size-3" />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-sm font-bold">{item.label}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{item.note}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <Card className="quick-dock overflow-hidden">
        <div className="flex items-center justify-between px-5 pb-2 pt-4 sm:px-6">
          <div className="flex items-center gap-2 text-sm font-extrabold"><Zap className="size-4 text-[#b78922]" /> פעולות מהירות</div>
          <span className="hidden text-xs text-muted-foreground sm:block">פחות חיפושים, יותר ביצוע</span>
        </div>
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          {quickActions.map((action) => (
            <Link key={action.href} href={action.href} className="group flex min-h-[84px] items-center gap-3 bg-card px-4 py-3 transition hover:bg-[#faf7f0] sm:justify-center">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-[#fffefa] text-primary shadow-sm transition group-hover:-translate-y-0.5 group-hover:border-primary/20"><action.icon className="size-[18px]" /></span>
              <span className="text-sm font-bold">{action.label}</span>
            </Link>
          ))}
        </div>
      </Card>

      <section className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-5">
          <CardHeader className="flex-row items-center justify-between">
            <div><CardTitle>אישורים ממתינים</CardTitle><p className="mt-1 text-xs text-muted-foreground">פעולות שמחכות להחלטה שלך</p></div>
            <Link href="/approvals" className="text-xs font-bold text-primary">הצגת הכל</Link>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {approvals.length === 0 && (
              <div className="flex min-h-28 flex-col items-center justify-center rounded-2xl border border-dashed bg-[#fbf9f4] p-5 text-center">
                <CheckCircle2 className="mb-2 size-6 text-[#64aa82]" />
                <p className="text-sm font-bold">אין אישורים שמחכים לך</p>
                <p className="mt-0.5 text-xs text-muted-foreground">כל הפעולות מעודכנות</p>
              </div>
            )}
            {approvals.map((approval) => (
              <Link key={approval.id} href="/approvals" className="block rounded-xl border p-3.5 text-sm transition hover:border-primary/25 hover:bg-primary/[0.025]">
                <div className="flex items-center justify-between gap-2"><span className="line-clamp-1 font-bold">{approval.title}</span><RiskBadge level={approval.riskLevel} /></div>
                <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{approval.reason}</p>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-7">
          <CardHeader className="flex-row items-center justify-between">
            <div><CardTitle>פעילות אחרונה</CardTitle><p className="mt-1 text-xs text-muted-foreground">מה המזכירה והמערכת עשו לאחרונה</p></div>
            <Link href="/activity" className="text-xs font-bold text-primary">מרכז הפעילות</Link>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border/70">
              {activity.slice(0, 5).map((item) => (
                <div key={item.id} className="flex min-h-[48px] items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className={`size-2 shrink-0 rounded-full ${item.result === "failure" ? "bg-destructive" : item.result === "waiting" ? "bg-warning" : "bg-success"}`} />
                  <div className="min-w-0 flex-1"><p className="line-clamp-1 text-sm font-semibold">{item.action}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{item.agent} · {timeAgo(item.createdAt)}</p></div>
                </div>
              ))}
              {activity.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">עדיין אין פעילות להצגה</p>}
            </div>
          </CardContent>
        </Card>
      </section>

      {brief.urgent.length > 0 && (
        <div className="risk-red flex items-start gap-3 rounded-2xl border border-red-100 px-4 py-3 text-sm"><BellRing className="mt-0.5 size-4 shrink-0" /><div><strong>דורש תשומת לב:</strong> {brief.urgent.join(" · ")}</div></div>
      )}
    </PageBody>
  );
}
