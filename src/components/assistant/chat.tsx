"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Sparkles, Plus, ShieldCheck, CheckSquare, Bell, Wrench, Paperclip, X, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cn, timeAgo } from "@/lib/utils";

interface Trace {
  intent: string;
  agents: string[];
  toolCalls: { tool: string; input: unknown; output?: { summary?: string } }[];
  approvalIds: string[];
  taskIds: string[];
  reminderIds: string[];
  provider: string;
  model: string;
  mock: boolean;
}
interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  trace?: Trace | null;
}

const SUGGESTIONS = [
  "תעשי לי סקירה של מה שפתוח היום",
  "תזכירי לי מחר ב-9:00 להתקשר לספק",
  "תטפלי בפנייה של מיכל לוי לגבי מנוי VIP",
  "תכיני 3 רעיונות להגדלת מכירות המועדון",
];

export function AssistantChat({
  conversations,
  workspaceName,
}: {
  conversations: { id: string; title: string; at: string }[];
  workspaceName: string;
}) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<{ id: string; title: string; kind: string; status: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/assistant/attachment", { method: "POST", body: fd });
      const d = await r.json();
      if (!d.error) setAttachments((a) => [...a, d]);
    } finally {
      setUploading(false);
    }
  }

  async function uploadText(text: string) {
    setUploading(true);
    try {
      const r = await fetch("/api/assistant/attachment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, title: "טקסט שהודבק" }),
      });
      const d = await r.json();
      if (!d.error) setAttachments((a) => [...a, d]);
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function loadConversation(id: string) {
    setConversationId(id);
    const r = await fetch(`/api/assistant?conversationId=${id}`);
    const data = await r.json();
    setMessages(
      (data.messages ?? []).map((m: Record<string, unknown>) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        trace: m.trace,
      })),
    );
  }

  async function send(text: string) {
    if ((!text.trim() && attachments.length === 0) || busy) return;
    setInput("");
    const atts = attachments;
    setAttachments([]);
    const label = atts.length ? `${text}${text ? "\n" : ""}📎 ${atts.map((a) => a.title).join(", ")}` : text;
    const userMsg: Msg = { id: `tmp-${Date.now()}`, role: "user", content: label };
    setMessages((m) => [...m, userMsg]);
    setBusy(true);
    try {
      const r = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversationId,
          attachments: atts.map((a) => ({ kind: "document", ref: a.id })),
        }),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setConversationId(data.conversationId);
      setMessages((m) => [
        ...m,
        { id: `a-${Date.now()}`, role: "assistant", content: data.reply, trace: data.trace },
      ]);
      router.refresh(); // update sidebar counts
    } catch (e) {
      setMessages((m) => [
        ...m,
        { id: `e-${Date.now()}`, role: "assistant", content: `שגיאה: ${e instanceof Error ? e.message : e}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* conversation list */}
      <div className="hidden w-56 shrink-0 flex-col border-l p-3 lg:flex">
        <Button
          variant="outline"
          size="sm"
          className="mb-2 justify-start"
          onClick={() => {
            setConversationId(null);
            setMessages([]);
          }}
        >
          <Plus className="size-4" /> שיחה חדשה
        </Button>
        <div className="flex-1 space-y-1 overflow-y-auto">
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => loadConversation(c.id)}
              className={cn(
                "w-full rounded-lg px-2.5 py-2 text-right text-xs transition-colors hover:bg-secondary",
                conversationId === c.id && "bg-secondary",
              )}
            >
              <div className="line-clamp-1 font-medium">{c.title}</div>
              <div className="text-[10px] text-muted-foreground">{timeAgo(c.at)}</div>
            </button>
          ))}
        </div>
      </div>

      {/* thread */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-6">
          {messages.length === 0 && (
            <div className="mx-auto max-w-xl pt-10 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles className="size-6" />
              </div>
              <h2 className="mt-3 text-lg font-semibold">מה נעשה ב-{workspaceName}?</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                אני מבצעת מה שאפשר אוטומטית ומעלה לאישור כל פעולה כלפי חוץ.
              </p>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-lg border p-3 text-right text-sm transition-colors hover:border-primary/40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={cn("flex", m.role === "user" ? "justify-start" : "justify-start")}>
              <div
                className={cn(
                  "max-w-2xl rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                  m.role === "user" ? "bg-primary text-primary-foreground" : "border bg-card",
                )}
              >
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.trace && <TraceBlock trace={m.trace} />}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex">
              <div className="rounded-2xl border bg-card px-4 py-2.5 text-sm text-muted-foreground">
                <span className="inline-flex gap-1">
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.2s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.1s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="border-t p-4">
          <div className="mx-auto max-w-3xl">
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {attachments.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1 rounded-md border bg-secondary px-2 py-1 text-xs">
                    <FileText className="size-3" />
                    {a.title}
                    {a.status === "processing" && <Loader2 className="size-3 animate-spin" />}
                    <button onClick={() => setAttachments((p) => p.filter((x) => x.id !== a.id))}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={fileRef}
                type="file"
                hidden
                onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
              />
              <Button
                variant="outline"
                size="icon"
                className="size-[52px] shrink-0"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                title="צירוף קובץ / צילום מסך"
              >
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
              </Button>
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={(e) => {
                  const file = e.clipboardData.files?.[0];
                  if (file) {
                    e.preventDefault();
                    uploadFile(file);
                    return;
                  }
                  const pasted = e.clipboardData.getData("text");
                  if (pasted.length > 600) {
                    e.preventDefault();
                    uploadText(pasted);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder='כתבי מה לעשות, או צרפי מייל/מסמך/צילום מסך ו"תטפלי בזה"'
                className="min-h-[52px] resize-none"
                rows={1}
              />
              <Button
                onClick={() => send(input)}
                disabled={busy || (!input.trim() && attachments.length === 0)}
                size="icon"
                className="size-[52px] shrink-0"
              >
                <Send className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TraceBlock({ trace }: { trace: Trace }) {
  const chips: { icon: typeof Wrench; label: string; href?: string }[] = [];
  if (trace.approvalIds.length)
    chips.push({ icon: ShieldCheck, label: `${trace.approvalIds.length} לאישור`, href: "/approvals" });
  if (trace.taskIds.length) chips.push({ icon: CheckSquare, label: `${trace.taskIds.length} משימות`, href: "/tasks" });
  if (trace.reminderIds.length) chips.push({ icon: Bell, label: `${trace.reminderIds.length} תזכורות`, href: "/calendar" });

  return (
    <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-secondary px-1.5 py-0.5">intent: {trace.intent}</span>
        {trace.agents.map((a) => (
          <span key={a} className="rounded bg-secondary px-1.5 py-0.5">
            {a}
          </span>
        ))}
        <span className="rounded bg-secondary px-1.5 py-0.5">
          {trace.mock ? "מצב לוקאלי" : `${trace.provider}/${trace.model}`}
        </span>
      </div>
      {trace.toolCalls.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {trace.toolCalls.map((t, i) => (
            <li key={i} className="flex items-center gap-1">
              <Wrench className="size-3" /> {t.tool}
              {t.output?.summary ? ` — ${t.output.summary}` : ""}
            </li>
          ))}
        </ul>
      )}
      {chips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {chips.map((c, i) => (
            <a key={i} href={c.href} className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-primary">
              <c.icon className="size-3" /> {c.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
