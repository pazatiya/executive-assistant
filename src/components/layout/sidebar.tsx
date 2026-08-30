"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV } from "./nav";

export function Sidebar({ counts }: { counts: Record<string, number> }) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-l bg-card/40 p-3 md:flex">
      <div className="flex items-center gap-2 px-2 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
          מ
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">המזכירה</div>
          <div className="text-[11px] text-muted-foreground">Executive Assistant</div>
        </div>
      </div>

      <nav className="mt-2 flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const count = item.countKey ? counts[item.countKey] : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                active ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <item.icon className="size-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
              {count > 0 && (
                <span className="rounded-md bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-2 text-[11px] text-muted-foreground">Phase 1 · לוקאלי</div>
    </aside>
  );
}
