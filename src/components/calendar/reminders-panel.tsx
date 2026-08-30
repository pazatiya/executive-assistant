"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Plus, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";

interface Reminder {
  id: string;
  title: string;
  description: string;
  kind: string;
  dueAt: string;
  recurrence: string | null;
  condition: string | null;
  status: string;
}

const KIND_LABEL: Record<string, string> = {
  one_time: "חד-פעמי",
  recurring: "חוזר",
  follow_up: "מעקב",
  condition: "מותנה",
  deadline: "דדליין",
  pre_event: "לפני אירוע",
};

export function RemindersPanel({ initial }: { initial: Reminder[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [recurrence, setRecurrence] = useState("");

  async function add() {
    if (!title.trim() || !when) return;
    const r = await fetch("/api/reminders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        dueAt: new Date(when).toISOString(),
        kind: recurrence ? "recurring" : "one_time",
        recurrence: recurrence || null,
      }),
    });
    const rem = await r.json();
    setItems((prev) => [rem, ...prev].sort((a, b) => a.dueAt.localeCompare(b.dueAt)));
    setTitle("");
    setWhen("");
    setRecurrence("");
    router.refresh();
  }

  const scheduled = items.filter((i) => i.status === "scheduled").sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const past = items.filter((i) => i.status !== "scheduled");

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Plus className="size-4" /> תזכורת חדשה
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <label className="mb-1 block text-xs text-muted-foreground">נושא</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="להתקשר לספק…" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">מתי</label>
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">חזרתיות</label>
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value)}
              className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
            >
              <option value="">ללא</option>
              <option value="daily">יומי</option>
              <option value="weekdays">ימי חול</option>
              <option value="weekly">שבועי</option>
              <option value="monthly">חודשי</option>
            </select>
          </div>
          <Button onClick={add} size="sm">
            הוסף
          </Button>
        </div>
      </Card>

      <div className="space-y-2">
        {scheduled.map((r) => (
          <Card key={r.id} className="flex items-center gap-3 p-3 text-sm">
            <Bell className="size-4 text-primary" />
            <div className="flex-1">
              <div className="font-medium">{r.title}</div>
              {r.condition && <div className="text-xs text-muted-foreground">תנאי: {r.condition}</div>}
            </div>
            <div className="text-xs text-muted-foreground">{formatDateTime(r.dueAt)}</div>
            <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">{KIND_LABEL[r.kind] ?? r.kind}</span>
            {r.recurrence && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Repeat className="size-3" />
                {r.recurrence}
              </span>
            )}
          </Card>
        ))}
        {scheduled.length === 0 && <p className="text-sm text-muted-foreground">אין תזכורות פעילות.</p>}
      </div>

      {past.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">היסטוריה</div>
          <div className="space-y-1.5">
            {past.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm opacity-70">
                <Bell className="size-3.5" />
                <span className="flex-1">{r.title}</span>
                <span className="text-xs">{r.status}</span>
                <span className="text-xs text-muted-foreground">{formatDateTime(r.dueAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
