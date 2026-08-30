"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check } from "lucide-react";
import { timeAgo, cn } from "@/lib/utils";

interface Notif {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  priority: string;
  readAt: string | null;
  createdAt: string;
}

export function NotificationsBell({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(initialUnread);
  const ref = useRef<HTMLDivElement>(null);

  async function load() {
    const r = await fetch("/api/notifications");
    const d = await r.json();
    setItems(d.items ?? []);
    setUnread(d.unread ?? 0);
  }

  useEffect(() => {
    const t = setInterval(load, 25000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open]);

  async function markAll() {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "mark_all_read" }),
    });
    setUnread(0);
    setItems((p) => p.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    router.refresh();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex size-9 items-center justify-center rounded-lg hover:bg-secondary"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -left-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-20 mt-1 w-80 overflow-hidden rounded-lg border bg-popover shadow-lg">
            <div className="flex items-center justify-between border-b p-3 text-sm font-medium">
              התראות
              {unread > 0 && (
                <button onClick={markAll} className="flex items-center gap-1 text-xs text-primary">
                  <Check className="size-3" /> סמן הכל כנקרא
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">אין התראות</p>}
              {items.map((n) => (
                <a
                  key={n.id}
                  href={n.href ?? "#"}
                  className={cn(
                    "block border-b p-3 text-sm last:border-0 hover:bg-secondary",
                    !n.readAt && "bg-primary/5",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{n.title}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                  </div>
                  {n.body && <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>}
                </a>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
