"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plug, Check, X, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Integration {
  provider: string;
  displayName: string;
  category: string;
  phase: number;
  authKind: string;
  setupHint: string;
  capabilities: { key: string; label: string; risk: string }[];
  status: string;
  accountLabel: string | null;
}

const CAT_LABEL: Record<string, string> = {
  email: "מייל",
  calendar: "יומן",
  storage: "אחסון",
  social: "רשתות חברתיות",
  messaging: "מסרים",
  commerce: "מסחר",
  database: "מסדי נתונים",
  dev: "פיתוח",
  automation: "אוטומציה",
  custom: "מותאם",
};

const STATUS: Record<string, { label: string; variant: "green" | "yellow" | "red" | "default" }> = {
  connected: { label: "מחובר", variant: "green" },
  not_connected: { label: "לא מחובר", variant: "default" },
  connecting: { label: "מתחבר…", variant: "yellow" },
  error: { label: "שגיאה", variant: "red" },
  coming_soon: { label: "בקרוב", variant: "default" },
};

const OAUTH_PROVIDERS = new Set(["gmail", "google_calendar", "google_drive", "google_sheets"]);

export function IntegrationsPanel({ initial }: { initial: Integration[] }) {
  const router = useRouter();
  const search = useSearchParams();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const connected = search.get("connected");
    const error = search.get("error");
    if (connected) setNotice({ kind: "ok", text: `${connected} חובר בהצלחה ✓` });
    else if (error === "google_not_configured")
      setNotice({ kind: "err", text: "Google OAuth לא מוגדר — הוסיפי GOOGLE_OAUTH_CLIENT_ID / SECRET ל-.env.local" });
    else if (error) setNotice({ kind: "err", text: `חיבור נכשל: ${error}` });
    if (connected || error) window.history.replaceState({}, "", "/integrations");
  }, [search]);

  const byCat = useMemo(() => {
    const g: Record<string, Integration[]> = {};
    for (const i of items) (g[i.category] ??= []).push(i);
    return g;
  }, [items]);

  async function toggle(provider: string, connected: boolean) {
    // real OAuth for Google providers
    if (OAUTH_PROVIDERS.has(provider) && !connected) {
      window.location.href = `/api/integrations/google/connect?provider=${provider}`;
      return;
    }
    setBusy(provider);
    try {
      await fetch("/api/integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, action: connected ? "disconnect" : "connect" }),
      });
      setItems((p) =>
        p.map((i) =>
          i.provider === provider
            ? { ...i, status: connected ? "not_connected" : "connected", accountLabel: connected ? null : `${provider} (dev)` }
            : i,
        ),
      );
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function sync(provider: string) {
    setBusy(provider);
    try {
      const r = await fetch(`/api/integrations/${provider}/sync`, { method: "POST" });
      const d = await r.json();
      setNotice(
        r.ok
          ? { kind: "ok", text: `${provider}: סונכרנו ${d.imported ?? 0} פריטים` }
          : { kind: "err", text: d.error ?? "סנכרון נכשל" },
      );
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {notice && (
        <Card className={`p-3 text-sm ${notice.kind === "ok" ? "risk-green" : "risk-red"}`}>{notice.text}</Card>
      )}
      <Card className="flex items-start gap-3 border-dashed p-4 text-sm">
        <Plug className="mt-0.5 size-5 text-muted-foreground" />
        <div className="text-muted-foreground">
          <b>Gmail</b> מחובר ב-OAuth אמיתי (צריך GOOGLE_OAUTH_CLIENT_ID/SECRET ב-.env.local). לשאר הספקים כפתור
          החיבור הוא מצב פיתוח — מסמן כמחובר לבדיקת זרימות; מימוש אמת נוסף לפי ה-<code>setupHint</code>.
        </div>
      </Card>

      {Object.entries(byCat).map(([cat, list]) => (
        <div key={cat}>
          <h2 className="mb-2 text-sm font-semibold">{CAT_LABEL[cat] ?? cat}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.map((i) => {
              const st = STATUS[i.status] ?? STATUS.not_connected;
              const connected = i.status === "connected";
              return (
                <Card key={i.provider} className="flex flex-col p-4 text-sm">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold">{i.displayName}</div>
                      <div className="text-xs text-muted-foreground">
                        Phase {i.phase} · {i.authKind}
                      </div>
                    </div>
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </div>

                  {i.accountLabel && <div className="mt-1 text-xs text-primary">{i.accountLabel}</div>}

                  <div className="mt-2 flex flex-wrap gap-1">
                    {i.capabilities.slice(0, 4).map((c) => (
                      <span
                        key={c.key}
                        className={`rounded px-1.5 py-0.5 text-[11px] ${
                          c.risk === "red" ? "risk-red" : c.risk === "yellow" ? "risk-yellow" : "risk-green"
                        }`}
                      >
                        {c.label}
                      </span>
                    ))}
                  </div>

                  <p className="mt-2 flex-1 text-[11px] text-muted-foreground">{i.setupHint}</p>

                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      variant={connected ? "outline" : "default"}
                      className="flex-1"
                      disabled={busy === i.provider}
                      onClick={() => toggle(i.provider, connected)}
                    >
                      {connected ? (
                        <>
                          <X className="size-4" /> נתק
                        </>
                      ) : OAUTH_PROVIDERS.has(i.provider) ? (
                        <>
                          <Check className="size-4" /> חיבור עם Google
                        </>
                      ) : (
                        <>
                          <Check className="size-4" /> חיבור (dev)
                        </>
                      )}
                    </Button>
                    {connected && i.provider === "gmail" && (
                      <Button size="sm" variant="secondary" disabled={busy === i.provider} onClick={() => sync(i.provider)}>
                        <RefreshCw className="size-4" /> סנכרן
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
