import { and, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { emails, messages, tasks } from "@/lib/db/schema";
import { nowIso } from "@/lib/utils";
import { ModelRouter } from "@/lib/ai/model-router";

export interface AdviceItem {
  kind: "unanswered_lead" | "bottleneck" | "automation" | "opportunity" | "cost" | "content";
  observation: string; // fact
  analysis: string; // interpretation
  recommendation: string; // suggested action
  severity: "info" | "notable" | "important";
}

/**
 * Proactive scan. Facts come from the DB; the LLM only phrases analysis +
 * recommendation. Fact / analysis / recommendation are kept separate per the
 * assistant policy.
 */
export async function generateAdvice(
  userId: string,
  workspaceId: string,
  topic?: string,
): Promise<AdviceItem[]> {
  const items: AdviceItem[] = [];
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();

  const staleLeadEmails = await db
    .select()
    .from(emails)
    .where(and(eq(emails.userId, userId), eq(emails.category, "lead"), eq(emails.status, "inbox"), lt(emails.receivedAt, dayAgo)));
  const staleLeadMsgs = await db
    .select()
    .from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.classification, "lead"), eq(messages.status, "new"), lt(messages.receivedAt, dayAgo)));

  if (staleLeadEmails.length + staleLeadMsgs.length > 0) {
    items.push({
      kind: "unanswered_lead",
      observation: `${staleLeadEmails.length + staleLeadMsgs.length} לידים ללא מענה מעל 24 שעות (${staleLeadEmails.length} במייל, ${staleLeadMsgs.length} ברשתות).`,
      analysis: "זמן תגובה ארוך ללידים מוריד שיעורי סגירה משמעותית.",
      recommendation: "להכין תשובה ראשונית לכל ליד ולהעלות לאישור עכשיו; לשקול תבנית מענה מהיר + אוטומציה שמתריעה אחרי שעה.",
      severity: "important",
    });
  }

  const waiting = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.status, "waiting")));
  if (waiting.length >= 3) {
    items.push({
      kind: "bottleneck",
      observation: `${waiting.length} משימות במצב "ממתין".`,
      analysis: "הצטברות של משימות ממתינות מרמזת על תלות בגורם חיצוני שלא נסגר.",
      recommendation: "לעבור על ה-follow-ups ולשלוח תזכורת לכל גורם שלא חזר.",
      severity: "notable",
    });
  }

  const overdue = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, userId), lt(tasks.dueDate, nowIso())));
  const trulyOverdue = overdue.filter((t) => !["completed", "failed"].includes(t.status));
  if (trulyOverdue.length) {
    items.push({
      kind: "bottleneck",
      observation: `${trulyOverdue.length} משימות עברו את תאריך היעד.`,
      analysis: "עומס או תעדוף לא מעודכן.",
      recommendation: "לקבוע תאריכי יעד חדשים או לפצל משימות גדולות; לשקול לדחות מה שלא קריטי.",
      severity: "notable",
    });
  }

  // LLM adds 1-2 opportunity/automation ideas grounded in the above facts
  if (!ModelRouter.resolve("advice").mock) {
    try {
      const res = await ModelRouter.complete("advice", {
        system:
          "אתה יועץ עסקי למזכירה אישית. בהתבסס על העובדות שסופקו בלבד, הצע עד 2 רעיונות (automation / opportunity / cost / content). " +
          'החזר JSON: {"items":[{"kind","observation","analysis","recommendation","severity"}]}. בעברית.',
        json: true,
        messages: [
          {
            role: "user",
            content: `נושא: ${topic || "סריקה כללית"}\nעובדות:\n${JSON.stringify(
              { staleLeads: staleLeadEmails.length + staleLeadMsgs.length, waiting: waiting.length, overdue: trulyOverdue.length },
            )}`,
          },
        ],
      });
      const parsed = JSON.parse(res.text) as { items?: AdviceItem[] };
      for (const it of parsed.items ?? []) items.push({ ...it, severity: it.severity ?? "info" });
    } catch {
      /* advice is best-effort */
    }
  }

  if (!items.length) {
    items.push({
      kind: "opportunity",
      observation: "אין כרגע לידים תקועים, משימות באיחור או צווארי בקבוק בולטים.",
      analysis: "מצב תפעולי תקין.",
      recommendation: "זמן טוב להשקיע במטרה ארוכת טווח — למשל הגדלת מכירות או בניית תהליך אוטומטי חדש.",
      severity: "info",
    });
  }
  return items;
}
