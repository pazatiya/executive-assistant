"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, Send, X, MessageCircle, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/utils";

export interface InboxMessage {
  id: string;
  authorName: string | null;
  authorHandle: string;
  channel: string;
  text: string;
  classification: string;
  sentiment: string;
  priority: string;
  status: string;
  draftReply: string | null;
  receivedAt: string;
}

const CLS: Record<string, string> = {
  lead: "ליד",
  complaint: "תלונה",
  question: "שאלה",
  spam: "ספאם",
  praise: "מחמאה",
  needs_human: "דורש טיפול",
  other: "אחר",
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  new: { label: "חדש", cls: "risk-yellow" },
  drafted: { label: "טיוטה מוכנה", cls: "risk-yellow" },
  waiting_approval: { label: "ממתין", cls: "risk-yellow" },
  replied: { label: "נענה", cls: "risk-green" },
  ignored: { label: "לא רלוונטי", cls: "text-muted-foreground" },
};

export function CustomerInbox({ messages }: { messages: InboxMessage[] }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [reachOpen, setReachOpen] = useState(false);
  const [reach, setReach] = useState({ phone: "", name: "", context: "" });
  const [reachMsg, setReachMsg] = useState<string | null>(null);

  async function sendReachOut() {
    if (!reach.phone.trim()) return;
    setBusy("reach");
    setReachMsg(null);
    try {
      const res = await fetch("/api/messages/reach-out", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reach),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setReach({ phone: "", name: "", context: "" });
        setReachOpen(false);
        router.refresh();
      } else {
        setReachMsg(data?.error ?? "שליחה נכשלה");
      }
    } finally {
      setBusy(null);
    }
  }

  const list = useMemo(
    () =>
      filter === "open"
        ? messages.filter((m) => m.status !== "replied" && m.status !== "ignored")
        : messages,
    [messages, filter],
  );

  async function act(id: string, action: "reply" | "ignore", text?: string) {
    setBusy(id);
    try {
      await fetch(`/api/messages/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, text }),
      });
      router.refresh();
      setOpenId(null);
    } finally {
      setBusy(null);
    }
  }

  const reachPanel = (
    <div className="mb-3">
      <button
        onClick={() => setReachOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm"
      >
        <UserPlus className="size-3.5" /> פנה ללקוח חדש
      </button>
      {reachOpen && (
        <div className="mt-2 space-y-2 rounded-xl border p-3">
          <p className="text-xs text-muted-foreground">
            לקוח שכתב לפרטי שלך? תן לג׳ימי את המספר — הוא יפתח שיחה מהמספר של DALOR והשיחה תיכנס לכאן.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={reach.phone}
              onChange={(e) => setReach((r) => ({ ...r, phone: e.target.value }))}
              placeholder="מספר טלפון (05…)"
              dir="ltr"
              className="min-w-[9rem] flex-1 rounded-lg border bg-background px-3 py-1.5 text-sm"
            />
            <input
              value={reach.name}
              onChange={(e) => setReach((r) => ({ ...r, name: e.target.value }))}
              placeholder="שם (לא חובה)"
              className="min-w-[9rem] flex-1 rounded-lg border bg-background px-3 py-1.5 text-sm"
            />
          </div>
          <input
            value={reach.context}
            onChange={(e) => setReach((r) => ({ ...r, context: e.target.value }))}
            placeholder="על מה הוא שאל? (למשל: חולצה במידה L / תור לשישי)"
            className="w-full rounded-lg border bg-background px-3 py-1.5 text-sm"
          />
          {reachMsg && <p className="text-xs text-red-400">{reachMsg}</p>}
          <button
            disabled={busy === "reach" || !reach.phone.trim()}
            onClick={sendReachOut}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <Send className="size-3.5" /> פתח שיחה
          </button>
        </div>
      )}
    </div>
  );

  if (!messages.length)
    return (
      <div>
        {reachPanel}
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          <MessageCircle className="mx-auto mb-2 size-6 opacity-50" />
          אין הודעות מלקוחות עדיין. כשלקוח יכתוב בוואטסאפ — זה יופיע כאן.
        </div>
      </div>
    );

  return (
    <div>
      {reachPanel}
      <div className="mb-3 flex items-center gap-2 text-sm">
        <button
          onClick={() => setFilter("open")}
          className={`rounded-lg px-3 py-1.5 ${filter === "open" ? "bg-primary text-primary-foreground" : "border"}`}
        >
          לטיפול ({messages.filter((m) => m.status !== "replied" && m.status !== "ignored").length})
        </button>
        <button
          onClick={() => setFilter("all")}
          className={`rounded-lg px-3 py-1.5 ${filter === "all" ? "bg-primary text-primary-foreground" : "border"}`}
        >
          הכל ({messages.length})
        </button>
      </div>

      <div className="divide-y rounded-xl border">
        {list.map((m) => {
          const open = openId === m.id;
          const draft = drafts[m.id] ?? m.draftReply ?? "";
          const st = STATUS_META[m.status] ?? { label: m.status, cls: "" };
          return (
            <div key={m.id} className="p-3">
              <button
                onClick={() => setOpenId(open ? null : m.id)}
                className="flex w-full items-start justify-between gap-3 text-right"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{m.authorName || m.authorHandle}</span>
                    <span className="text-[11px] text-muted-foreground" dir="ltr">
                      {m.authorHandle}
                    </span>
                    {m.classification !== "other" && (
                      <Badge variant={m.classification === "complaint" ? "red" : m.classification === "lead" ? "primary" : "default"}>
                        {CLS[m.classification] ?? m.classification}
                      </Badge>
                    )}
                    <span className={`rounded px-1.5 py-0.5 text-[11px] ${st.cls}`}>{st.label}</span>
                  </div>
                  <p className={`mt-0.5 text-sm ${open ? "" : "line-clamp-1"} text-muted-foreground`}>{m.text}</p>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(m.receivedAt)}</span>
              </button>

              {open && (
                <div className="mt-3 space-y-2">
                  {m.status !== "replied" && m.status !== "ignored" ? (
                    <>
                      <div className="text-xs font-medium text-primary">תשובה מוצעת — ערוך ושלח:</div>
                      <textarea
                        value={draft}
                        onChange={(e) => setDrafts((d) => ({ ...d, [m.id]: e.target.value }))}
                        rows={4}
                        className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                        placeholder="כתוב תשובה…"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          disabled={busy === m.id || !draft.trim()}
                          onClick={() => act(m.id, "reply", draft)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                        >
                          <Send className="size-3.5" /> שלח ללקוח
                        </button>
                        <button
                          disabled={busy === m.id}
                          onClick={() => act(m.id, "ignore")}
                          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
                        >
                          <X className="size-3.5" /> לא רלוונטי
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-lg bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
                      {m.status === "replied" ? (
                        <span className="flex items-center gap-1.5">
                          <Check className="size-3.5 text-success" /> נענה: {m.draftReply}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          <Clock className="size-3.5" /> סומן כלא רלוונטי
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
