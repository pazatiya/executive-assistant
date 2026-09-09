"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_GROUPS } from "./nav";

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
        className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-card text-foreground shadow-sm md:hidden"
      >
        <Menu className="size-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-[#10111f]/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 right-0 flex w-[310px] max-w-[88vw] flex-col overflow-y-auto bg-[#17182a] p-4 text-white shadow-2xl">
            <div className="flex items-center justify-between px-2 py-3">
              <div className="flex items-center gap-2">
                <img
                  src="/assistant-avatar-head.png"
                  alt="המזכירה"
                  className="size-10 shrink-0 rounded-2xl object-cover"
                />
                <div className="leading-tight">
                  <div className="text-sm font-bold">המזכירה</div>
                  <div className="mt-1 text-[11px] text-white/45">העוזרת האישית של DALOR</div>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="סגור תפריט"
                className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white"
              >
                <X className="size-5" />
              </button>
            </div>

            <Link href="/assistant" className="my-3 flex items-center justify-center gap-2 rounded-xl bg-white px-3 py-2.5 text-sm font-bold text-[#24223b]">
              <Sparkles className="size-4 text-primary" /> משימה חדשה למזכירה
            </Link>

            <nav className="mt-2 flex flex-1 flex-col gap-4">
              {NAV_GROUPS.map((group) => (
                <div key={group.label}>
                  <div className="mb-1 px-3 text-[10px] font-semibold tracking-widest text-white/30">{group.label}</div>
                  {group.items.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(item.href + "/");
                    const count = item.countKey ? counts[item.countKey] : 0;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                          active ? "bg-white/10 font-semibold text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white",
                        )}
                      >
                        <item.icon className={cn("size-4 shrink-0", active && "text-[#a99cff]")} />
                        <span className="flex-1">{item.label}</span>
                        {count > 0 && <span className="rounded-full bg-[#e3b752] px-2 py-0.5 text-[10px] font-bold text-[#30240b]">{count}</span>}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>
          </aside>
        </div>
      )}
    </>
  );
}
