import Link from "next/link";
import { ArrowLeft, CheckSquare, ShieldCheck, Mail, Users2, Sparkles } from "lucide-react";
import { PageHeader, PageBody } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RiskBadge } from "@/components/shared/labels";
import { loadAppContext } from "@/lib/app-context";
import { buildMorningBrief } from "@/lib/services/brief";
import { listActivity } from "@/lib/services/activity";
import { listApprovals } from "@/lib/services/approvals";
import { timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { user } = await loadAppContext();
  const [brief, activity, approvals] = await Promise.all([
    buildMorningBrief(user.id),
    listActivity(user.id, { limit: 8 }),
    listApprovals(user.id, { statuses: ["pending"], limit: 5 }),
  ]);

  const stat = [
    { label: "משימות פתוחות", value: brief.openTasks.length, href: "/tasks", icon: CheckSquare },
    { label: "אישורים ממתינים", value: brief.waitingApprovals.length, href: "/approvals", icon: ShieldCheck },
    { label: "מיילים חשובים", value: brief.importantEmails.length, href: "/messages", icon: Mail },
    { label: "לידים חדשים", value: brief.newLeads.length, href: "/messages", icon: Users2 },
  ];

  return (
    <>
      <PageHeader title={`בוקר טוב, ${user.fullName || "פז"}`} description="סקירת הבוקר וסדר העדיפויות המוצע להיום">
        <Link
          href="/assistant"
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          <Sparkles className="size-4" /> דברי עם המזכירה
        </Link>
      </PageHeader>

      <PageBody className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stat.map((s) => (
            <Link key={s.label} href={s.href}>
              <Card className="transition-colors hover:border-primary/40">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <s.icon className="size-5" />
                  </div>
                  <div>
                    <div className="text-2xl font-semibold">{s.value}</div>
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Morning Brief</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {brief.urgent.length > 0 && (
                <div className="rounded-lg risk-red px-3 py-2">
                  <div className="font-semibold">דחוף</div>
                  <ul className="mt-1 list-disc pr-4">
                    {brief.urgent.map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="mb-1 font-semibold">סדר עדיפויות מוצע</div>
                <ol className="list-decimal space-y-1 pr-4 text-muted-foreground">
                  {brief.suggestedOrder.length ? (
                    brief.suggestedOrder.map((s, i) => <li key={i}>{s}</li>)
                  ) : (
                    <li>אין משימות דחופות — יום פנוי יחסית.</li>
                  )}
                </ol>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <BriefList title="משימות באיחור" items={brief.overdueTasks.map((t) => t.title)} empty="אין" />
                <BriefList
                  title="לידים חדשים"
                  items={brief.newLeads.map((l) => `${l.who} · ${l.source}`)}
                  empty="אין"
                />
                <BriefList
                  title="מיילים חשובים"
                  items={brief.importantEmails.map((e) => `${e.from}: ${e.subject}`)}
                  empty="אין"
                />
                <BriefList
                  title="אישורים ממתינים"
                  items={brief.waitingApprovals.map((a) => a.title)}
                  empty="אין"
                />
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>אישורים ממתינים</CardTitle>
                <Link href="/approvals" className="text-xs text-primary">
                  הכל
                </Link>
              </CardHeader>
              <CardContent className="space-y-2">
                {approvals.length === 0 && <p className="text-sm text-muted-foreground">אין אישורים ממתינים 🎉</p>}
                {approvals.map((a) => (
                  <Link
                    key={a.id}
                    href="/approvals"
                    className="block rounded-lg border p-3 text-sm transition-colors hover:border-primary/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="line-clamp-1 font-medium">{a.title}</span>
                      <RiskBadge level={a.riskLevel} />
                    </div>
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{a.reason}</p>
                  </Link>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>פעילות אחרונה</CardTitle>
                <Link href="/activity" className="text-xs text-primary">
                  הכל
                </Link>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {activity.map((a) => (
                  <div key={a.id} className="flex items-start gap-2">
                    <span
                      className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                        a.result === "failure"
                          ? "bg-destructive"
                          : a.result === "waiting"
                            ? "bg-warning"
                            : "bg-success"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1">{a.action}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.agent} · {timeAgo(a.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>

        <Link href="/activity" className="inline-flex items-center gap-1 text-sm text-primary">
          למרכז הפעילות המלא <ArrowLeft className="size-4" />
        </Link>
      </PageBody>
    </>
  );
}

function BriefList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <div className="mb-1 font-semibold">{title}</div>
      {items.length ? (
        <ul className="space-y-0.5 text-muted-foreground">
          {items.slice(0, 4).map((t, i) => (
            <li key={i} className="line-clamp-1">
              • {t}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}
