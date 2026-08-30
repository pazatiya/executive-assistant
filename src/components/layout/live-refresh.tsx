"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Lightweight "live" updates: revalidates server components on an interval and
 * when the tab regains focus. Cheap and reliable; swap for SSE/websockets later
 * if sub-second latency is ever needed.
 */
export function LiveRefresh({ intervalMs = 25000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const t = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, intervalMs]);
  return null;
}
