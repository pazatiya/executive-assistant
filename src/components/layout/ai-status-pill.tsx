"use client";

import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";

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
      className="hidden items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs sm:flex"
      title={
        status.mockMode
          ? "לא מחובר מפתח AI — המזכירה עובדת במצב לוקאלי דטרמיניסטי"
          : `מחובר: ${live?.name}`
      }
    >
      <Cpu className="size-3.5" />
      {status.mockMode ? (
        <span className="text-muted-foreground">מצב לוקאלי (ללא AI)</span>
      ) : (
        <span className="text-success">AI: {live?.name}</span>
      )}
    </div>
  );
}
