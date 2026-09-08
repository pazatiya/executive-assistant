"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import { NAV_GROUPS } from "./nav";

export function Sidebar({ counts }: { counts: Record<string, number> }) {
  const pathname = usePathname();
  return (
    <aside className="relative hidden w-[272px] shrink-0 flex-col overflow-hidden border-l border-white/10 bg-[#17182a] p-4 text-white md:flex">
      <div className="pointer-events-none absolute -right-24 -top-24 size-60 rounded-full bg-primary/25 blur-3xl" />
      <div className="relative flex items-center gap-3 px-2 pb-5 pt-2">
        <div className="flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br from-[#8d79ff] to-[#5743d9] text-white shadow-lg shadow-violet-950/30">
          <Sparkles className="size-[18px]" />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-bold tracking-tight">המזכירה</div>
          <div className="mt-1 text-[11px] text-white/45">העוזרת האישית של DALOR</div>
        </div>
      </div>

      <Link
        href="/assistant"
        className="relative mb-4 flex items-center justify-center gap-2 rounded-xl bg-white px-3 py-2.5 text-sm font-bold text-[#24223b] shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:shadow-xl"
      >
        <Sparkles className="size-4 text-primary" />
        משימה חדשה למזכירה
      </Link>

      <nav className="relative flex flex-1 flex-col gap-4 overflow-y-auto pl-1">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="mb-1.5 px-3 text-[10px] font-semibold tracking-[0.12em] text-white/30">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                const count = item.countKey ? counts[item.countKey] : 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] transition-all",
                      active
                        ? "bg-white/[0.11] font-semibold text-white shadow-sm"
                        : "text-white/58 hover:bg-white/[0.06] hover:text-white",
                    )}
                  >
                    <span className={cn("flex size-7 items-center justify-center rounded-lg transition-colors", active ? "bg-primary text-white" : "bg-white/[0.04] group-hover:bg-white/[0.08]")}>
                      <item.icon className="size-[15px] shrink-0" />
                    </span>
                    <span className="flex-1">{item.label}</span>
                    {count > 0 && (
                      <span className="flex min-w-5 items-center justify-center rounded-full bg-[#e3b752] px-1.5 py-0.5 text-[10px] font-bold text-[#30240b]">
                        {count}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="relative mt-3 flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.035] px-3 py-2.5 text-[11px] text-white/55">
        <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.09)]" />
        המערכת פעילה ומסונכרנת
      </div>
    </aside>
  );
}
