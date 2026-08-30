"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Pencil, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { RiskBadge } from "@/components/shared/labels";
import { cn, formatDateTime } from "@/lib/utils";

interface Approval {
  id: string;
  title: string;
  context: string;
  actionType: string;
  targetSystem: string;
  riskLevel: "green" | "yellow" | "red";
  reason: string;
  preview: string;
  proposedBy: string;
  status: string;
  actionPayload: Record<string, unknown>;
  createdAt: string;
  decidedAt: string | null;
  executionResult: { detail?: string } | null;
}

const TABS = [
  { key: "pending", label: "ממתינים" },
  { key: "decided", label: "היסטוריה" },
] as const;

export function ApprovalCenter({ initial }: { initial: Approval[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("pending");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const shown = useMemo(
    () => items.filter((i) => (tab === "pending" ? i.status === "pending" : i.status !== "pending")),
    [items, tab],
  );

  async function decide(id: string, decision: string, editedPayload?: Record<string, unknown>) {
    setPendingId(id);
    try {
      const r = await fetch(`/api/approvals/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, editedPayload }),
      });
      const data = await r.json();
      const newStatus =
        decision === "reject" ? "rejected" : data?.result?.result?.ok === false ? "failed" : "executed";
      setItems((prev) =>
        prev.map((i) =>
          i.id === id
            ? { ...i, status: newStatus, decidedAt: new Date().toISOString(), executionResult: data?.result?.result ?? null }
            : i,
        ),
      );
      setEditing(null);
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  const previewKey = (a: Approval) =>
    a.actionType === "reply_message" ? "text" : a.actionType === "send_email" ? "body" : null;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg border p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm",
              tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
            )}
          >
            {t.label}
            {t.key === "pending" && (
              <span className="mr-1.5 rounded bg-background/20 px-1 text-xs">
                {items.filter((i) => i.status === "pending").length}
              </span>
            )}
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          <ShieldCheck className="mx-auto mb-2 size-8 opacity-40" />
          {tab === "pending" ? "אין אישורים ממתינים." : "אין היסטוריית אישורים."}
        </Card>
      )}

      <div className="grid gap-4">
        {shown.map((a) => {
          const pk = previewKey(a);
          const isEditing = editing === a.id;
          return (
            <Card key={a.id} className="overflow-hidden">
              <div className="flex items-start justify-between gap-3 border-b p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <RiskBadge level={a.riskLevel} />
                    <span className="text-xs text-muted-foreground">
                      {a.proposedBy} → {a.targetSystem || "—"} · {a.actionType}
                    </span>
                  </div>
                  <h3 className="mt-1.5 font-semibold">{a.title}</h3>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</span>
              </div>

              <div className="space-y-3 p-4 text-sm">
                {a.context && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-muted-foreground">מה קרה</div>
                    <p className="whitespace-pre-wrap rounded-lg bg-secondary/50 p-2.5 text-xs">{a.context}</p>
                  </div>
                )}

                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">למה נדרש אישור</div>
                  <p className="text-xs">{a.reason}</p>
                </div>

                {(a.preview || pk) && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-muted-foreground">
                      {a.actionType === "change_price" ? "פרטי הפעולה" : "תוכן מוצע"}
                    </div>
                    {isEditing ? (
                      <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} className="text-xs" />
                    ) : (
                      <p className="whitespace-pre-wrap rounded-lg border border-dashed p-2.5 text-xs">{a.preview}</p>
                    )}
                  </div>
                )}

                {a.status !== "pending" && (
                  <div
                    className={cn(
                      "rounded-lg px-2.5 py-2 text-xs",
                      a.status === "rejected" ? "risk-red" : a.status === "failed" ? "risk-yellow" : "risk-green",
                    )}
                  >
                    {a.status === "rejected"
                      ? "נדחה"
                      : a.status === "failed"
                        ? `בוצע חלקית / נכשל: ${a.executionResult?.detail ?? ""}`
                        : `בוצע: ${a.executionResult?.detail ?? "הפעולה הושלמה"}`}
                  </div>
                )}
              </div>

              {a.status === "pending" && (
                <div className="flex flex-wrap items-center gap-2 border-t bg-secondary/30 p-3">
                  {isEditing ? (
                    <>
                      <Button
                        size="sm"
                        variant="success"
                        disabled={pendingId === a.id}
                        onClick={() => decide(a.id, "edit_approve", pk ? { [pk]: draft, preview: draft } : { preview: draft })}
                      >
                        <Check className="size-4" /> אשר עם השינוי
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        ביטול
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="success" disabled={pendingId === a.id} onClick={() => decide(a.id, "approve")}>
                        <Check className="size-4" /> אישור
                      </Button>
                      {(a.preview || pk) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditing(a.id);
                            setDraft(a.preview);
                          }}
                        >
                          <Pencil className="size-4" /> עריכה
                        </Button>
                      )}
                      <Button size="sm" variant="outline" disabled={pendingId === a.id} onClick={() => decide(a.id, "reject")}>
                        <X className="size-4" /> דחייה
                      </Button>
                      {a.riskLevel !== "red" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mr-auto text-xs"
                          disabled={pendingId === a.id}
                          onClick={() => decide(a.id, "always_allow")}
                          title="לא לבקש אישור לפעולה מסוג זה בעתיד"
                        >
                          <Zap className="size-3.5" /> תמיד לאשר מסוג זה
                        </Button>
                      )}
                    </>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
