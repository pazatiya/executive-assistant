"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

interface WS {
  id: string;
  name: string;
  type: string;
  description: string;
  color: string;
  brandVoice: { tone?: string; formality?: string; signature?: string; doList?: string[]; dontList?: string[] };
}

export function WorkspacesPanel({
  initial,
  stats,
}: {
  initial: WS[];
  stats: Record<string, { tasks: number; goals: number; contacts: number; memories: number }>;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", type: "business", description: "", color: "#6366f1" });

  async function create() {
    if (!form.name.trim()) return;
    const r = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const ws = await r.json();
    setItems((p) => [...p, { ...ws, brandVoice: {} }]);
    setOpen(false);
    setForm({ name: "", type: "business", description: "", color: "#6366f1" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Button size="sm" onClick={() => setOpen((o) => !o)}>
        <Plus className="size-4" /> Workspace חדש
      </Button>

      {open && (
        <Card className="grid gap-2 p-4 sm:grid-cols-2">
          <Input placeholder="שם" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="personal">אישי</option>
            <option value="business">עסק</option>
            <option value="project">פרויקט</option>
          </select>
          <Textarea className="sm:col-span-2" placeholder="תיאור" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          <div className="flex items-center gap-2">
            <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-9 w-14 rounded border" />
            <Button size="sm" onClick={create}>
              צור
            </Button>
          </div>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {items.map((w) => {
          const s = stats[w.id] ?? { tasks: 0, goals: 0, contacts: 0, memories: 0 };
          return (
            <Card key={w.id} className="p-4">
              <div className="flex items-center gap-2">
                <span className="size-3 rounded-full" style={{ background: w.color }} />
                <span className="font-semibold">{w.name}</span>
                <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">{w.type}</span>
              </div>
              {w.description && <p className="mt-1 text-xs text-muted-foreground">{w.description}</p>}

              <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                {[
                  ["משימות", s.tasks],
                  ["מטרות", s.goals],
                  ["אנשי קשר", s.contacts],
                  ["כללים", s.memories],
                ].map(([label, n]) => (
                  <div key={label as string} className="rounded-lg bg-secondary/50 p-2">
                    <div className="text-base font-semibold">{n}</div>
                    <div className="text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>

              {(w.brandVoice?.tone || w.brandVoice?.signature) && (
                <div className="mt-3 rounded-lg border p-2 text-xs">
                  <div className="font-medium">סגנון כתיבה</div>
                  {w.brandVoice.tone && <div className="text-muted-foreground">טון: {w.brandVoice.tone}</div>}
                  {w.brandVoice.formality && <div className="text-muted-foreground">רשמיות: {w.brandVoice.formality}</div>}
                  {w.brandVoice.signature && <div className="text-muted-foreground">חתימה: {w.brandVoice.signature}</div>}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Layers className="size-3.5" /> החלפת workspace פעיל — מהבורר בראש הדף.
      </p>
    </div>
  );
}
