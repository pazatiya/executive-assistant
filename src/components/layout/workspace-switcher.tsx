"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface WS {
  id: string;
  name: string;
  type: string;
  color: string;
}

export function WorkspaceSwitcher({ workspaces, activeId }: { workspaces: WS[]; activeId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];

  function select(id: string) {
    setOpen(false);
    start(async () => {
      await fetch("/api/workspaces/active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: id }),
      });
      router.refresh();
    });
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        className="flex h-9 min-w-[190px] items-center gap-2 rounded-lg border border-input bg-card px-3 text-sm"
      >
        <span className="size-2.5 rounded-full" style={{ background: active?.color }} />
        <span className="flex-1 text-right font-medium">{active?.name ?? "—"}</span>
        <ChevronsUpDown className="size-4 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-full min-w-[220px] overflow-hidden rounded-lg border bg-popover p-1 shadow-lg">
            {workspaces.map((w) => (
              <button
                key={w.id}
                onClick={() => select(w.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-secondary",
                  w.id === activeId && "bg-secondary",
                )}
              >
                <span className="size-2.5 rounded-full" style={{ background: w.color }} />
                <span className="flex-1 text-right">{w.name}</span>
                <span className="text-[11px] text-muted-foreground">{w.type}</span>
                {w.id === activeId && <Check className="size-3.5 text-primary" />}
              </button>
            ))}
            <a
              href="/workspaces"
              className="mt-1 block rounded-md px-2.5 py-2 text-xs text-muted-foreground hover:bg-secondary"
            >
              ניהול Workspaces →
            </a>
          </div>
        </>
      )}
    </div>
  );
}
