"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Target, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";

interface Goal {
  id: string;
  title: string;
  description: string;
  metric: string | null;
  target: string | null;
  currentValue: string | null;
  deadline: string | null;
  status: string;
  progress: number;
  strategy: { nextActions?: string[]; experiments?: { hypothesis: string; result?: string }[]; whatWorked?: string[]; whatDidnt?: string[] };
}

export function GoalsPanel({
  initial,
  tasksByGoal,
}: {
  initial: Goal[];
  tasksByGoal: Record<string, { id: string; title: string; status: string }[]>;
}) {
  const router = useRouter();
  const [goals, setGoals] = useState(initial);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", metric: "", target: "", deadline: "" });

  async function create() {
    if (!form.title.trim()) return;
    const r = await fetch("/api/goals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const g = await r.json();
    setGoals((p) => [g, ...p]);
    setOpen(false);
    setForm({ title: "", description: "", metric: "", target: "", deadline: "" });
    router.refresh();
  }

  async function setProgress(id: string, progress: number) {
    setGoals((p) => p.map((g) => (g.id === id ? { ...g, progress } : g)));
    await fetch(`/api/goals/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ progress }),
    });
  }

  return (
    <div className="space-y-4">
      <Button size="sm" onClick={() => setOpen((o) => !o)}>
        <Plus className="size-4" /> מטרה חדשה
      </Button>

      {open && (
        <Card className="space-y-3 p-4">
          <Input placeholder="כותרת (למשל: להגדיל מכירות ב-20%)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Textarea placeholder="תיאור" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          <div className="grid gap-2 sm:grid-cols-3">
            <Input placeholder="מדד" value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })} />
            <Input placeholder="יעד" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
            <Input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
          </div>
          <Button size="sm" onClick={create}>
            צור מטרה
          </Button>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {goals.map((g) => (
          <Card key={g.id} className="p-4">
            <div className="flex items-start gap-2">
              <Target className="mt-0.5 size-4 text-primary" />
              <div className="flex-1">
                <h3 className="font-semibold">{g.title}</h3>
                {g.description && <p className="mt-0.5 text-xs text-muted-foreground">{g.description}</p>}
              </div>
              <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">{g.status}</span>
            </div>

            {(g.metric || g.target) && (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <TrendingUp className="size-3.5 text-success" />
                <span>{g.metric}</span>
                <span className="text-muted-foreground">
                  {g.currentValue ?? "?"} → {g.target ?? "?"}
                </span>
                {g.deadline && <span className="text-muted-foreground">· עד {formatDateTime(g.deadline)}</span>}
              </div>
            )}

            <div className="mt-3">
              <div className="mb-1 flex justify-between text-xs">
                <span>התקדמות</span>
                <span>{g.progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${g.progress}%` }} />
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={g.progress}
                onChange={(e) => setProgress(g.id, Number(e.target.value))}
                className="mt-1 w-full accent-primary"
              />
            </div>

            {g.strategy?.nextActions && g.strategy.nextActions.length > 0 && (
              <div className="mt-2">
                <div className="text-xs font-medium">Next actions</div>
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {g.strategy.nextActions.map((a, i) => (
                    <li key={i}>• {a}</li>
                  ))}
                </ul>
              </div>
            )}

            {tasksByGoal[g.id]?.length > 0 && (
              <div className="mt-2 border-t pt-2">
                <div className="text-xs font-medium">משימות מקושרות</div>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {tasksByGoal[g.id].map((t) => (
                    <li key={t.id} className="flex justify-between">
                      <span>{t.title}</span>
                      <span className="text-muted-foreground">{t.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        ))}
        {goals.length === 0 && <p className="text-sm text-muted-foreground">אין מטרות עדיין.</p>}
      </div>
    </div>
  );
}
