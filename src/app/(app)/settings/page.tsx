import { Cpu, Database, KeyRound, Bot, ShieldCheck } from "lucide-react";
import { PageHeader, PageBody } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";
import { AI_MOCK_MODE, env } from "@/lib/env";
import { ACTION_CATALOG } from "@/lib/approval/engine";
import { ModelSwitcher } from "@/components/settings/model-switcher";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  const agentRows = await db.select().from(agents);

  const byRisk = { green: [] as string[], yellow: [] as string[], red: [] as string[] };
  for (const [k, v] of Object.entries(ACTION_CATALOG)) byRisk[v as "green" | "yellow" | "red"].push(k);

  return (
    <>
      <PageHeader title="הגדרות" description="מודל AI, סוכנים, מדיניות אישורים, נתונים ואימות" />
      <PageBody className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <Cpu className="size-4" />
            <CardTitle>מודל AI</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {AI_MOCK_MODE && (
              <div className="rounded-lg risk-yellow px-3 py-2 text-xs">
                אין אף מפתח AI מחובר — מצב לוקאלי דטרמיניסטי. הדביקי מפתח Anthropic או Google (Gemini) בצ׳אט.
              </div>
            )}
            <ModelSwitcher />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <Bot className="size-4" />
            <CardTitle>סוכנים</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {agentRows.map((a) => (
              <div key={a.id} className="rounded-lg border p-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{a.name}</span>
                  <Badge variant="outline">{a.category}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{a.description}</p>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              ה-Orchestrator מקבל כל בקשה ומחליט אילו סוכנים/כלים מפעיל. autonomy פר-סוכן נשמר ב-<code>agent_settings</code>.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <ShieldCheck className="size-4" />
            <CardTitle>מדיניות אישורים</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <RiskRow color="green" title="GREEN · אוטומטי" items={byRisk.green} />
            <RiskRow color="yellow" title="YELLOW · לפי הרשאה" items={byRisk.yellow} />
            <RiskRow color="red" title="RED · אישור חובה תמיד" items={byRisk.red} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <Database className="size-4" />
            <CardTitle>נתונים ואימות</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="DB driver" value={env.dbDriver} note={env.dbDriver === "libsql" ? "SQLite מקומי" : "Supabase Postgres"} />
            <Row label="Auth driver" value={env.authDriver} note={env.authDriver === "dev" ? "משתמש לוקאלי יחיד" : "Supabase Auth"} />
            <Row label="משתמש" value={user.email} />
            <Row label="אזור זמן" value={env.appTimezone} />
            <div className="mt-2 flex items-start gap-2 rounded-lg border p-2 text-xs text-muted-foreground">
              <KeyRound className="mt-0.5 size-3.5" />
              מעבר ל-Supabase: מלאי SUPABASE_URL / KEYS ב-<code>.env.local</code>, הפעילי{" "}
              <code>supabase/migrations</code>, ושני <code>DB_DRIVER=supabase</code> + <code>AUTH_DRIVER=supabase</code>.
            </div>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>
        <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">{value}</code>
        {note && <span className="mr-2 text-xs text-muted-foreground">{note}</span>}
      </span>
    </div>
  );
}

function RiskRow({ color, title, items }: { color: "green" | "yellow" | "red"; title: string; items: string[] }) {
  return (
    <div className={`rounded-lg px-2.5 py-2 risk-${color}`}>
      <div className="font-semibold">{title}</div>
      <div className="mt-0.5 opacity-80">{items.join(" · ")}</div>
    </div>
  );
}
