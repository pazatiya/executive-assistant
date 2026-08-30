"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Bot, User, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { PriorityTag } from "@/components/shared/labels";
import { cn, formatDateTime } from "@/lib/utils";

type Status = "inbox" | "planned" | "in_progress" | "waiting" | "waiting_approval" | "completed" | "failed";

interface Task {
  id: string;
  title: string;
  description: string;
  status: Status;
  priority: string;
  dueDate: string | null;
  createdBy: string;
  source: string;
  followUpAt: string | null;
  outcome: string | null;
  plan: { step: string; status: string; note?: string }[];
}

const COLUMNS: { key: Status; label: string }[] = [
  { key: "inbox", label: "Inbox" },
  { key: "planned", label: "מתוכנן" },
  { key: "in_progress", label: "בעבודה" },
  { key: "waiting", label: "ממתין" },
  { key: "waiting_approval", label: "ממתין לאישור" },
  { key: "completed", label: "הושלם" },
];

const NEXT: Partial<Record<Status, Status>> = {
  inbox: "in_progress",
  planned: "in_progress",
  in_progress: "completed",
  waiting: "in_progress",
  waiting_approval: "completed",
};

export function TaskBoard({ initial }: { initial: Task[] }) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initial);
  const [title, setTitle] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  async function add() {
    if (!title.trim()) return;
    const r = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
    const t = await r.json();
    setTasks((prev) => [t, ...prev]);
    setTitle("");
    router.refresh();
  }

  async function setStatus(id: string, status: Status) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="משימה חדשה…"
          className="max-w-md"
        />
        <Button onClick={add} size="sm">
          <Plus className="size-4" /> הוסף
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.key);
          if (col.key === "completed" && colTasks.length === 0) return null;
          return (
            <div key={col.key} className="space-y-2">
              <div className="flex items-center justify-between px-1 text-xs font-medium text-muted-foreground">
                <span>{col.label}</span>
                <span>{colTasks.length}</span>
              </div>
              {colTasks.length === 0 && (
                <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">ריק</div>
              )}
              {colTasks.map((t) => {
                const isOpen = expanded === t.id;
                return (
                  <Card key={t.id} className="p-3 text-sm">
                    <button className="flex w-full items-start gap-2 text-right" onClick={() => setExpanded(isOpen ? null : t.id)}>
                      <span title={t.createdBy === "assistant" ? "נוצר ע״י המזכירה" : "נוצר על ידך"}>
                        {t.createdBy === "assistant" ? (
                          <Bot className="mt-0.5 size-3.5 text-primary" />
                        ) : (
                          <User className="mt-0.5 size-3.5 text-muted-foreground" />
                        )}
                      </span>
                      <span className="flex-1 font-medium leading-snug">{t.title}</span>
                      {isOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    </button>

                    <div className="mt-1.5 flex items-center gap-2 pr-5">
                      <PriorityTag value={t.priority} />
                      {t.dueDate && <span className="text-xs text-muted-foreground">יעד {formatDateTime(t.dueDate)}</span>}
                      {t.followUpAt && <span className="text-xs text-warning">follow-up</span>}
                    </div>

                    {isOpen && (
                      <div className="mt-2 space-y-2 border-t pt-2 pr-5 text-xs">
                        {t.description && <p className="text-muted-foreground">{t.description}</p>}
                        {t.plan?.length > 0 && (
                          <ol className="space-y-1">
                            {t.plan.map((p, i) => (
                              <li key={i} className="flex items-center gap-1.5">
                                <span
                                  className={cn(
                                    "size-1.5 rounded-full",
                                    p.status === "done"
                                      ? "bg-success"
                                      : p.status === "blocked"
                                        ? "bg-destructive"
                                        : "bg-muted-foreground/40",
                                  )}
                                />
                                <span className={p.status === "done" ? "line-through opacity-60" : ""}>{p.step}</span>
                                {p.note && <span className="text-muted-foreground">({p.note})</span>}
                              </li>
                            ))}
                          </ol>
                        )}
                        {t.outcome && (
                          <p className="rounded bg-secondary/50 p-1.5">
                            <span className="font-medium">תוצאה רצויה:</span> {t.outcome}
                          </p>
                        )}
                      </div>
                    )}

                    {NEXT[t.status] && (
                      <div className="mt-2 flex gap-1.5 pr-5">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setStatus(t.id, NEXT[t.status]!)}>
                          → {COLUMNS.find((c) => c.key === NEXT[t.status])?.label}
                        </Button>
                        {t.status !== "waiting" && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setStatus(t.id, "waiting")}>
                            ממתין
                          </Button>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
