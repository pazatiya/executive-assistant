"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

export function AiStatusPill() {
  const [status, setStatus] = useState<{
    mockMode: boolean;
    defaultProvider: string;
    providers: { name: string; available: boolean }[];
  } | null>(null);

  useEffect(() => {
    fetch("/api/ai/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  if (!status) return null;
  // Show the provider actually used by default, not merely the first with a key.
  const live =
    status.providers.find((p) => p.name === status.defaultProvider && p.available) ??
    status.providers.find((p) => p.available);

  return (
    <div
      className="hidden h-10 items-center gap-2 rounded-xl border bg-card px-3 text-xs shadow-sm lg:flex"
      title={
        status.mockMode
          ? "לא מחובר מפתח AI — המזכירה עובדת במצב לוקאלי דטרמיניסטי"
          : `מחובר: ${live?.name}`
      }
    >
      <span className={`size-2 rounded-full ${status.mockMode ? "bg-amber-400" : "bg-emerald-500"}`} />
      <Sparkles className="size-3.5 text-primary" />
      {status.mockMode ? (
        <span className="text-muted-foreground">מצב לוקאלי (ללא AI)</span>
      ) : (
        <span className="text-success">AI: {live?.name}</span>
      )}
    </div>
  );
}
