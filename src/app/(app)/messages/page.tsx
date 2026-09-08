import { desc } from "drizzle-orm";
import { Mail } from "lucide-react";
import { PageHeader, PageBody } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { loadAppContext } from "@/lib/app-context";
import { db } from "@/lib/db";
import { emails, messages } from "@/lib/db/schema";
import { listScope } from "@/lib/auth/scope";
import { getAssistantMode } from "@/lib/services/workspaces";
import { CustomerInbox, type InboxMessage } from "@/components/messages/customer-inbox";
import { timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

const CAT_LABEL: Record<string, string> = {
  lead: "ליד",
  complaint: "תלונה",
  question: "שאלה",
  invoice: "חשבונית",
  business: "עסקי",
  newsletter: "ניוזלטר",
  other: "אחר",
  unknown: "לא מסווג",
};

export default async function MessagesPage() {
  const { user, activeWorkspace } = await loadAppContext();
  const [emailScope, msgScope] = await Promise.all([
    listScope({ userId: emails.userId, workspaceId: emails.workspaceId }, user.id),
    listScope({ userId: messages.userId, workspaceId: messages.workspaceId }, user.id),
  ]);
  const [em, sm, mode] = await Promise.all([
    db.select().from(emails).where(emailScope).orderBy(desc(emails.receivedAt)).limit(50),
    db.select().from(messages).where(msgScope).orderBy(desc(messages.receivedAt)).limit(100),
    getAssistantMode(activeWorkspace?.id ?? null),
  ]);

  const inbox: InboxMessage[] = sm.map((m) => ({
    id: m.id,
    authorName: m.authorName,
    authorHandle: m.authorHandle,
    channel: m.channel,
    text: m.text,
    classification: m.classification,
    sentiment: m.sentiment,
    priority: m.priority,
    status: m.status,
    draftReply: m.draftReply,
    receivedAt: m.receivedAt,
    mediaId: m.mediaId,
  }));

  return (
    <>
      <PageHeader
        title="הודעות מלקוחות"
        description={
          mode === "active"
            ? "המזכירה עונה לבד על שעות / כתובת / מחירון / זמינות תור. כל השאר מחכה לך כאן."
            : "מצב טיוטות: המזכירה מכינה תשובה לכל הודעה — ואתם שולחים מכאן. שום דבר לא נשלח אוטומטית."
        }
      >
        <span
          className={`rounded-lg px-2.5 py-1 text-xs font-medium ${mode === "active" ? "risk-green" : "risk-yellow"}`}
        >
          {mode === "active" ? "מצב פעיל" : "מצב טיוטות"}
        </span>
      </PageHeader>

      <PageBody className="space-y-6">
        <CustomerInbox messages={inbox} />

        {em.length > 0 && (
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Mail className="size-4" /> מייל ({em.length})
            </h2>
            <div className="space-y-2">
              {em.map((e) => (
                <Card key={e.id} className="p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{e.fromName || e.fromAddress}</span>
                        <Badge variant={e.category === "lead" ? "primary" : "default"}>
                          {CAT_LABEL[e.category] ?? e.category}
                        </Badge>
                      </div>
                      <div className="mt-0.5 font-medium">{e.subject}</div>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{e.snippet}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(e.receivedAt)}</span>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}
      </PageBody>
    </>
  );
}
