"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Brain, ShieldAlert, BookOpen, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Memory {
  id: string;
  type: string;
  subject: string;
  content: string;
  ruleKind: string | null;
  ruleTarget: string | null;
  importance: string;
  source: string;
  workspaceId: string | null;
  confidence: number;
}

const TYPE_META: Record<string, { label: string; icon: typeof Brain }> = {
  permanent: { label: "Permanent · כללים", icon: ShieldAlert },
  working: { label: "Working · הקשר", icon: Clock },
  knowledge: { label: "Knowledge Base", icon: BookOpen },
  activity: { label: "Activity", icon: Brain },
};

export function MemoryPanel({ initial, workspaceName }: { initial: Memory[]; workspaceName: string }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ subject: "", content: "", type: "permanent", ruleKind: "", ruleTarget: "", importance: "high", global: true });

  const grouped = useMemo(() => {
    const g: Record<string, Memory[]> = {};
    for (const m of items) (g[m.type] ??= []).push(m);
    return g;
  }, [items]);

  async function create() {
    if (!form.subject.trim() || !form.content.trim()) return;
    const r = await fetch("/api/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const m = await r.json();
    setItems((p) => [m, ...p]);
    setOpen(false);
    setForm({ subject: "", content: "", type: "permanent", ruleKind: "", ruleTarget: "", importance: "high", global: true });
    router.refresh();
  }

  async function remove(id: string) {
    setItems((p) => p.filter((m) => m.id !== id));
    await fetch(`/api/memory/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Button size="sm" onClick={() => setOpen((o) => !o)}>
        <Plus className="size-4" /> כלל / ידע חדש
      </Button>

      {open && (
        <Card className="space-y-3 p-4">
          <Input placeholder='נושא (למשל: "אישור לפני שינוי מחיר")' value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          <Textarea placeholder="התוכן / הכלל המלא" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={2} />
          <div className="grid gap-2 sm:grid-cols-4">
            <select className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="permanent">Permanent</option>
              <option value="working">Working</option>
              <option value="knowledge">Knowledge</option>
            </select>
            <select className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm" value={form.ruleKind} onChange={(e) => setForm({ ...form, ruleKind: e.target.value })}>
              <option value="">— סוג כלל —</option>
              <option value="always_require_approval">תמיד אישור</option>
              <option value="never_delete_from">לא למחוק מ...</option>
              <option value="auto_reply_allowed">מותר להשיב אוטומטית</option>
              <option value="writing_style">סגנון כתיבה</option>
              <option value="do_not">אל תעשי</option>
            </select>
            <Input placeholder="יעד (שולח / פעולה)" value={form.ruleTarget} onChange={(e) => setForm({ ...form, ruleTarget: e.target.value })} />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={form.global} onChange={(e) => setForm({ ...form, global: e.target.checked })} />
              חל על כל ה-Workspaces
            </label>
          </div>
          <Button size="sm" onClick={create}>
            שמור כלל
          </Button>
        </Card>
      )}

      {Object.entries(TYPE_META).map(([type, meta]) => {
        const list = grouped[type];
        if (!list?.length) return null;
        return (
          <div key={type}>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <meta.icon className="size-4" /> {meta.label}
            </div>
            <div className="grid gap-2">
              {list.map((m) => (
                <Card key={m.id} className="flex items-start gap-3 p-3 text-sm">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{m.subject}</span>
                      {m.ruleKind && <Badge variant="primary">{m.ruleKind}</Badge>}
                      {m.ruleTarget && <span className="text-xs text-muted-foreground">→ {m.ruleTarget}</span>}
                      <Badge
                        variant={m.importance === "critical" ? "red" : m.importance === "high" ? "yellow" : "default"}
                      >
                        {m.importance}
                      </Badge>
                      <span className={cn("text-xs", m.workspaceId ? "text-muted-foreground" : "text-primary")}>
                        {m.workspaceId ? workspaceName : "כל ה-Workspaces"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{m.content}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">מקור: {m.source} · ודאות {m.confidence}%</p>
                  </div>
                  <button onClick={() => remove(m.id)} className="rounded p-1 text-muted-foreground hover:text-destructive">
                    <Trash2 className="size-4" />
                  </button>
                </Card>
              ))}
            </div>
          </div>
        );
      })}
      {items.length === 0 && <p className="text-sm text-muted-foreground">אין זיכרון עדיין.</p>}
    </div>
  );
}
