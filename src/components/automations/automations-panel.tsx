"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap, Trash2, Plus, Mail, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, timeAgo } from "@/lib/utils";

interface Rule {
  id: string;
  name: string;
  trigger: string;
  condition: { field?: string; op?: string; value?: string };
  actionType: string;
  forceApproval: boolean;
  enabled: boolean;
  runCount: number;
  lastRunAt: string | null;
  workspaceId: string | null;
}
interface Sender {
  id: string;
  sender: string;
  category: string;
  priority: string;
  autoArchive: boolean;
  autoReplyAllowed: boolean;
  approvalRequired: boolean;
  notes: string;
}
interface Template {
  name: string;
  trigger: string;
  condition: { field: string; op: string; value?: string | number };
  actionType: string;
  forceApproval: boolean;
}

const TRIGGER_LABEL: Record<string, string> = {
  "email.received": "מייל נכנס",
  "message.received": "הודעה ברשת",
  "reminder.due": "תזכורת הגיעה",
  "task.overdue": "משימה באיחור",
  "lead.detected": "זוהה ליד",
};

export function AutomationsPanel({
  rules: initialRules,
  senders: initialSenders,
  templates,
}: {
  rules: Rule[];
  senders: Sender[];
  templates: Template[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"rules" | "senders">("rules");
  const [rules, setRules] = useState(initialRules);
  const [senders, setSenders] = useState(initialSenders);
  const [newSender, setNewSender] = useState({ sender: "", category: "newsletter", autoArchive: true, approvalRequired: false, autoReplyAllowed: false });

  async function addFromTemplate(t: Template) {
    const r = await fetch("/api/automations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...t, global: true }),
    });
    const rule = await r.json();
    setRules((p) => [rule, ...p]);
    router.refresh();
  }

  async function toggleRule(id: string, enabled: boolean) {
    setRules((p) => p.map((r) => (r.id === id ? { ...r, enabled } : r)));
    await fetch(`/api/automations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  }
  async function delRule(id: string) {
    setRules((p) => p.filter((r) => r.id !== id));
    await fetch(`/api/automations/${id}`, { method: "DELETE" });
    router.refresh();
  }

  async function addSender() {
    if (!newSender.sender.trim()) return;
    const r = await fetch("/api/sender-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(newSender),
    });
    const s = await r.json();
    setSenders((p) => [s, ...p]);
    setNewSender({ sender: "", category: "newsletter", autoArchive: true, approvalRequired: false, autoReplyAllowed: false });
    router.refresh();
  }
  async function delSender(id: string) {
    setSenders((p) => p.filter((s) => s.id !== id));
    await fetch(`/api/sender-rules?id=${id}`, { method: "DELETE" });
    router.refresh();
  }

  const usedTemplates = new Set(rules.map((r) => r.name));

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg border p-1 w-fit">
        {(
          [
            ["rules", "חוקים"],
            ["senders", "כללי שולח (מייל)"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm",
              tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "rules" && (
        <>
          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Plus className="size-4" /> תבניות מוכנות
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {templates.map((t) => (
                <button
                  key={t.name}
                  disabled={usedTemplates.has(t.name)}
                  onClick={() => addFromTemplate(t)}
                  className="rounded-lg border p-3 text-right text-sm transition-colors hover:border-primary/40 disabled:opacity-40"
                >
                  <div className="font-medium">{t.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {TRIGGER_LABEL[t.trigger]} · {t.condition.field}={String(t.condition.value)} → {t.actionType}
                    {t.forceApproval ? " · אישור חובה" : ""}
                  </div>
                </button>
              ))}
            </div>
          </Card>

          <div className="space-y-2">
            {rules.map((r) => (
              <Card key={r.id} className="flex items-center gap-3 p-3 text-sm">
                <Zap className={cn("size-4", r.enabled ? "text-primary" : "text-muted-foreground")} />
                <div className="flex-1">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {TRIGGER_LABEL[r.trigger] ?? r.trigger}
                    {r.condition?.field ? ` · ${r.condition.field} ${r.condition.op} ${r.condition.value}` : ""} → {r.actionType}
                    {r.forceApproval && " · אישור חובה"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    רץ {r.runCount} פעמים{r.lastRunAt ? ` · אחרון ${timeAgo(r.lastRunAt)}` : ""}
                    {!r.workspaceId && " · כל ה-Workspaces"}
                  </div>
                </div>
                <button
                  onClick={() => toggleRule(r.id, !r.enabled)}
                  className={cn("rounded-md p-1.5", r.enabled ? "text-success" : "text-muted-foreground")}
                  title={r.enabled ? "פעיל" : "כבוי"}
                >
                  <Power className="size-4" />
                </button>
                <button onClick={() => delRule(r.id)} className="rounded-md p-1.5 text-muted-foreground hover:text-destructive">
                  <Trash2 className="size-4" />
                </button>
              </Card>
            ))}
            {rules.length === 0 && <p className="text-sm text-muted-foreground">אין חוקים עדיין — הוסיפי מתבנית למעלה.</p>}
          </div>
        </>
      )}

      {tab === "senders" && (
        <>
          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Mail className="size-4" /> כלל שולח חדש
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Input
                placeholder="כתובת / דומיין (למשל newsletter@ או @spam.com)"
                value={newSender.sender}
                onChange={(e) => setNewSender({ ...newSender, sender: e.target.value })}
                className="max-w-xs"
              />
              <select
                className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
                value={newSender.category}
                onChange={(e) => setNewSender({ ...newSender, category: e.target.value })}
              >
                {["newsletter", "business", "personal", "invoice", "service", "system", "spam", "lead"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={newSender.autoArchive} onChange={(e) => setNewSender({ ...newSender, autoArchive: e.target.checked })} />
                ארכוב אוטומטי
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={newSender.autoReplyAllowed} onChange={(e) => setNewSender({ ...newSender, autoReplyAllowed: e.target.checked })} />
                תשובה אוטומטית מותרת
              </label>
              <Button size="sm" onClick={addSender}>הוסף</Button>
            </div>
          </Card>

          <div className="space-y-2">
            {senders.map((s) => (
              <Card key={s.id} className="flex items-center gap-3 p-3 text-sm">
                <Mail className="size-4 text-muted-foreground" />
                <div className="flex-1">
                  <span className="font-medium">{s.sender}</span>
                  <div className="mt-0.5 flex flex-wrap gap-1.5">
                    <Badge>{s.category}</Badge>
                    {s.autoArchive && <Badge variant="yellow">ארכוב אוטו׳</Badge>}
                    {s.autoReplyAllowed && <Badge variant="green">תשובה אוטו׳</Badge>}
                    {s.approvalRequired && <Badge variant="red">אישור חובה</Badge>}
                  </div>
                </div>
                <button onClick={() => delSender(s.id)} className="rounded-md p-1.5 text-muted-foreground hover:text-destructive">
                  <Trash2 className="size-4" />
                </button>
              </Card>
            ))}
            {senders.length === 0 && <p className="text-sm text-muted-foreground">אין כללי שולח.</p>}
          </div>
        </>
      )}
    </div>
  );
}
