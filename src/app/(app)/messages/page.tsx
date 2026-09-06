import { desc } from "drizzle-orm";
import { Mail, Instagram, Plug, AlertTriangle } from "lucide-react";
import { PageHeader, PageBody } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { loadAppContext } from "@/lib/app-context";
import { db } from "@/lib/db";
import { emails, messages } from "@/lib/db/schema";
import { listScope } from "@/lib/auth/scope";
import { listIntegrations } from "@/lib/integrations/registry";
import { timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

const CAT_LABEL: Record<string, string> = {
  lead: "ליד",
  complaint: "תלונה",
  question: "שאלה",
  invoice: "חשבונית",
  newsletter: "ניוזלטר",
  business: "עסקי",
  personal: "אישי",
  spam: "ספאם",
  praise: "מחמאה",
  needs_human: "דורש טיפול",
  other: "אחר",
  system: "מערכת",
  service: "שירות",
  unknown: "לא מסווג",
};

export default async function MessagesPage() {
  const { user } = await loadAppContext();
  const [emailScope, msgScope] = await Promise.all([
    listScope({ userId: emails.userId, workspaceId: emails.workspaceId }, user.id),
    listScope({ userId: messages.userId, workspaceId: messages.workspaceId }, user.id),
  ]);
  const [em, sm, integrations] = await Promise.all([
    db.select().from(emails).where(emailScope).orderBy(desc(emails.receivedAt)),
    db.select().from(messages).where(msgScope).orderBy(desc(messages.receivedAt)),
    listIntegrations(user.id),
  ]);
  const connected = new Set(integrations.filter((i) => i.status === "connected").map((i) => i.provider));

  return (
    <>
      <PageHeader
        title="הודעות ותקשורת"
        description="מייל ורשתות חברתיות במקום אחד. הנתונים כרגע הם דמו — חיבור Gmail / Instagram יביא הודעות אמת."
      />
      <PageBody className="space-y-6">
        {!connected.has("gmail") && !connected.has("instagram") && (
          <Card className="flex items-center gap-3 border-dashed p-4 text-sm">
            <Plug className="size-5 text-muted-foreground" />
            <span className="flex-1 text-muted-foreground">
              אף ערוץ לא מחובר עדיין. הכל למטה הוא נתוני דמו כדי להראות את הזרימה: סיווג → טיוטה → אישור.
            </span>
            <a href="/integrations" className="rounded-lg border px-3 py-1.5 text-xs">
              אינטגרציות
            </a>
          </Card>
        )}

        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Mail className="size-4" /> תיבת מייל ({em.length})
          </h2>
          <div className="space-y-2">
            {em.map((e) => (
              <Card key={e.id} className="p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{e.fromName || e.fromAddress}</span>
                      <Badge variant={e.category === "lead" ? "primary" : "default"}>{CAT_LABEL[e.category]}</Badge>
                      {e.priority === "urgent" || e.priority === "high" ? (
                        <Badge variant="yellow">{e.priority === "urgent" ? "דחוף" : "גבוה"}</Badge>
                      ) : null}
                      {e.replyRequired && <Badge variant="outline">דורש תשובה</Badge>}
                    </div>
                    <div className="mt-0.5 font-medium">{e.subject}</div>
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{e.snippet}</p>
                    {e.aiSummary && (
                      <p className="mt-1 rounded bg-primary/5 px-2 py-1 text-xs text-primary">🤖 {e.aiSummary}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(e.receivedAt)}</span>
                </div>
                {e.status !== "inbox" && (
                  <div className="mt-1.5 text-xs text-muted-foreground">סטטוס: {e.status}</div>
                )}
              </Card>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Instagram className="size-4" /> רשתות חברתיות ({sm.length})
          </h2>
          <div className="space-y-2">
            {sm.map((m) => (
              <Card key={m.id} className="p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{m.authorName || m.authorHandle}</span>
                      <span className="text-xs text-muted-foreground">{m.channel} · {m.kind === "comment" ? "תגובה" : "הודעה"}</span>
                      <Badge
                        variant={m.classification === "complaint" ? "red" : m.classification === "lead" ? "primary" : "default"}
                      >
                        {CAT_LABEL[m.classification] ?? m.classification}
                      </Badge>
                      {m.sentiment === "negative" && (
                        <span className="inline-flex items-center gap-1 text-xs text-destructive">
                          <AlertTriangle className="size-3" /> שלילי — אישור חובה
                        </span>
                      )}
                    </div>
                    <p className="mt-1">{m.text}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(m.receivedAt)}</span>
                </div>
                {m.status !== "new" && <div className="mt-1.5 text-xs text-muted-foreground">סטטוס: {m.status}</div>}
              </Card>
            ))}
          </div>
        </section>
      </PageBody>
    </>
  );
}
