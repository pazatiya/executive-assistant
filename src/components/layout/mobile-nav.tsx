"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV } from "./nav";

/** Hamburger button + slide-in drawer — the phone-width equivalent of <Sidebar>,
 * which is `hidden` below the `md` breakpoint with no other way to reach it. */
export function MobileNav({ counts }: { counts: Record<string, number> }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // close the drawer automatically once a link is followed
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="פתח תפריט"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg border md:hidden"
      >
        <Menu className="size-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-l bg-card p-3 shadow-xl">
            <div className="flex items-center justify-between px-2 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
                  מ
                </div>
                <div className="leading-tight">
                  <div className="text-sm font-semibold">המזכירה</div>
                  <div className="text-[11px] text-muted-foreground">Executive Assistant</div>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="סגור תפריט"
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            <nav className="mt-2 flex flex-1 flex-col gap-0.5">
              {NAV.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                const count = item.countKey ? counts[item.countKey] : 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-primary/15 text-primary font-medium"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
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
          </aside>
        </div>
      )}
    </>
  );
}
