"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ProviderStatus {
  name: string;
  available: boolean;
  defaultModel: string;
  models: { id: string; label: string; tier: string }[];
}

const PROVIDER_LABEL: Record<string, string> = { anthropic: "Anthropic (Claude)", google: "Google (Gemini)", openai: "OpenAI (GPT)" };
const KEY_HINT: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY — console.anthropic.com",
  google: "GOOGLE_API_KEY — aistudio.google.com/apikey",
  openai: "OPENAI_API_KEY — platform.openai.com",
};

export function ModelSwitcher() {
  const router = useRouter();
  const [data, setData] = useState<{ status: { defaultProvider: string; providers: ProviderStatus[] }; current: { provider?: string; model?: string } } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () =>
    fetch("/api/settings/ai")
      .then((r) => r.json())
      .then(setData);
  useEffect(() => {
    load();
  }, []);

  async function save(provider: string | null, model: string | null) {
    setSaving(true);
    try {
      await fetch("/api/settings/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, model }),
      });
      await load();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (!data) return <div className="text-sm text-muted-foreground">טוען…</div>;

  const currentProvider = data.current?.provider ?? "auto";
  const currentModel = data.current?.model ?? null;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">מצב:</span>
        <button
          onClick={() => save(null, null)}
          className={cn(
            "rounded-lg border px-2.5 py-1 text-xs",
            currentProvider === "auto" ? "border-primary bg-primary/10 text-primary" : "hover:bg-secondary",
          )}
        >
          אוטומטי (ברירת מחדל + failover)
        </button>
        {saving && <Loader2 className="size-3.5 animate-spin" />}
      </div>

      <div className="space-y-2">
        {data.status.providers.map((p) => (
          <div key={p.name} className={cn("rounded-lg border p-3", !p.available && "opacity-60")}>
            <div className="flex items-center justify-between">
              <span className="font-medium">{PROVIDER_LABEL[p.name] ?? p.name}</span>
              {p.available ? (
                <Badge variant="green">מפתח מחובר</Badge>
              ) : (
                <Badge variant="default">לא מוגדר</Badge>
              )}
            </div>
            {!p.available && <p className="mt-1 text-xs text-muted-foreground">{KEY_HINT[p.name]}</p>}
            {p.available && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {p.models.map((m) => {
                  const active = currentProvider === p.name && (currentModel === m.id || (!currentModel && m.id === p.defaultModel));
                  return (
                    <button
                      key={m.id}
                      onClick={() => save(p.name, m.id)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
                        active ? "border-primary bg-primary/10 text-primary" : "hover:bg-secondary",
                      )}
                    >
                      {active && <Check className="size-3" />}
                      {m.label}
                      <span className="text-[10px] text-muted-foreground">{m.tier}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        הבחירה נשמרת פר-משתמש. במצב אוטומטי המערכת מתחילה מ-{data.status.defaultProvider} ועוברת לספק הבא הזמין אם
        הנוכחי נכשל (אין קרדיט / rate limit) — באמצע הבקשה, בלי ליפול למצב לוקאלי.
      </p>
    </div>
  );
}
