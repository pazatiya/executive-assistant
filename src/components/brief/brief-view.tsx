"use client";

import { useState } from "react";
import { Sunrise, Sunset, Bell, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { EndOfDayBrief, MorningBrief } from "@/lib/services/brief";

export function BriefView({ morning, eod }: { morning: MorningBrief; eod: EndOfDayBrief }) {
  const [tab, setTab] = useState<"morning" | "eod">("morning");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function send() {
    setSending(true);
    try {
      await fetch("/api/brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: tab }),
      });
      setSent(true);
      setTimeout(() => setSent(false), 3000);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-lg border p-1">
          <button
            onClick={() => setTab("morning")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
              tab === "morning" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
            )}
          >
            <Sunrise className="size-4" /> בוקר
          </button>
          <button
            onClick={() => setTab("eod")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
              tab === "eod" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
            )}
          >
            <Sunset className="size-4" /> סוף יום
          </button>
        </div>
        <Button size="sm" variant="outline" onClick={send} disabled={sending}>
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />}
          {sent ? "נשלח ✓" : "שלח כהתראה"}
        </Button>
      </div>

      {tab === "morning" ? (
        <div className="grid gap-4 md:grid-cols-2">
          {morning.urgent.length > 0 && (
            <Card className="risk-red p-4 md:col-span-2">
              <div className="font-semibold">דחוף</div>
              <ul className="mt-1 list-disc pr-4 text-sm">
                {morning.urgent.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            </Card>
          )}
          <Card className="p-4 md:col-span-2">
            <div className="mb-2 font-semibold">סדר עדיפויות מוצע</div>
            <ol className="list-decimal space-y-1 pr-4 text-sm text-muted-foreground">
              {morning.suggestedOrder.length ? morning.suggestedOrder.map((s, i) => <li key={i}>{s}</li>) : <li>יום פנוי יחסית.</li>}
            </ol>
          </Card>
          <Section title={`פגישות היום (${morning.meetingsToday.length})`} items={morning.meetingsToday.map((m) => m.title)} />
          <Section title={`מיילים חשובים (${morning.importantEmails.length})`} items={morning.importantEmails.map((e) => `${e.from}: ${e.subject}`)} />
          <Section title={`לידים חדשים (${morning.newLeads.length})`} items={morning.newLeads.map((l) => `${l.who} · ${l.source}`)} />
          <Section title={`אישורים ממתינים (${morning.waitingApprovals.length})`} items={morning.waitingApprovals.map((a) => `[${a.riskLevel}] ${a.title}`)} />
          <Section title={`משימות פתוחות (${morning.openTasks.length})`} items={morning.openTasks.map((t) => `${t.title} · ${t.status}`)} />
          <Section title={`משימות באיחור (${morning.overdueTasks.length})`} items={morning.overdueTasks.map((t) => t.title)} />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Section title={`הושלם (${eod.completed.length})`} items={eod.completed.map((t) => t.title)} />
          <Section title={`עדיין פתוח (${eod.stillOpen.length})`} items={eod.stillOpen.map((t) => `${t.title} · ${t.status}`)} />
          <Section title={`ממתין (${eod.waiting.length})`} items={eod.waiting.map((t) => t.title)} />
          <Section title={`אישורים היום (${eod.approvals.length})`} items={eod.approvals.map((a) => `${a.title} · ${a.status}`)} />
          {eod.problems.length > 0 && (
            <Card className="risk-yellow p-4 md:col-span-2">
              <div className="font-semibold">תקלות</div>
              <ul className="mt-1 list-disc pr-4 text-sm">
                {eod.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </Card>
          )}
          <Card className="p-4 md:col-span-2">
            <div className="mb-1 font-semibold">למחר</div>
            <ul className="list-disc space-y-1 pr-4 text-sm text-muted-foreground">
              {eod.suggestionsForTomorrow.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <Card className="p-4">
      <div className="mb-1 text-sm font-semibold">{title}</div>
      {items.length ? (
        <ul className="space-y-0.5 text-sm text-muted-foreground">
          {items.map((t, i) => (
            <li key={i} className="line-clamp-1">
              • {t}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">—</p>
      )}
    </Card>
  );
}
