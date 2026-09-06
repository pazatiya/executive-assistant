"use client";

import { useEffect, useState } from "react";

type Mode = "draft_only" | "active";

export function AssistantModeToggle() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings/assistant")
      .then((r) => r.json())
      .then((d) => setMode(d.mode))
      .catch(() => setMode("draft_only"));
  }, []);

  async function set(next: Mode) {
    setBusy(true);
    try {
      const r = await fetch("/api/settings/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      if (r.ok) setMode(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5 text-sm">
      <button
        disabled={busy}
        onClick={() => set("draft_only")}
        className={`w-full rounded-lg border p-3 text-right transition-colors ${
          mode === "draft_only" ? "border-primary bg-primary/10" : "hover:border-primary/40"
        }`}
      >
        <div className="font-medium">מצב טיוטות (מומלץ להתחלה)</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          המזכירה מכינה תשובה לכל הודעה — אתם קוראים ושולחים מהמסך "הודעות". שום דבר לא נשלח אוטומטית.
        </div>
      </button>
      <button
        disabled={busy}
        onClick={() => set("active")}
        className={`w-full rounded-lg border p-3 text-right transition-colors ${
          mode === "active" ? "border-primary bg-primary/10" : "hover:border-primary/40"
        }`}
      >
        <div className="font-medium">מצב פעיל</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          המזכירה עונה לבד על: שעות פתיחה, כתובת, מחירון מספרה, זמינות תור. שאלות על בגדים, מחירים, תלונות
          וכל השאר — עדיין מחכות לכם במסך.
        </div>
      </button>
      {mode === null && <div className="text-xs text-muted-foreground">טוען…</div>}
    </div>
  );
}
