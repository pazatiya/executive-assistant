import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { senderRules } from "@/lib/db/schema";
import { ModelRouter } from "@/lib/ai/model-router";

export type EmailCategory =
  | "personal" | "business" | "service" | "invoice" | "system" | "newsletter" | "spam" | "lead" | "unknown";

export interface EmailClassification {
  category: EmailCategory;
  priority: "low" | "normal" | "high" | "urgent";
  replyRequired: boolean;
  summary: string;
}

/**
 * Email Agent — classifies an inbound email. Sender rules win; then the LLM (if
 * available) reads intent; otherwise keyword heuristics. Never sends anything.
 */
export async function classifyEmail(input: {
  from: string;
  subject: string;
  snippet: string;
  userId?: string;
}): Promise<EmailClassification> {
  // 1. sender rules
  if (input.userId) {
    const rules = await db
      .select()
      .from(senderRules)
      .where(eq(senderRules.userId, input.userId));
    const match = rules.find((r) => input.from.toLowerCase().includes(r.sender.toLowerCase()));
    if (match) {
      return {
        category: match.category as EmailCategory,
        priority: match.priority,
        replyRequired: match.category === "lead" || match.category === "personal",
        summary: `כלל שולח: ${match.notes || match.category}`,
      };
    }
  }

  // 2. LLM
  const route = ModelRouter.resolve("classification");
  if (!route.mock) {
    try {
      const res = await ModelRouter.complete("classification", {
        system:
          "סווג מייל נכנס עבור מזכירה אישית. INTENT_CLASSIFIER. החזר JSON: " +
          '{"category": one of ["personal","business","service","invoice","system","newsletter","spam","lead"], ' +
          '"priority": one of ["low","normal","high","urgent"], "replyRequired": boolean, "summary": "משפט אחד בעברית"}',
        json: true,
        messages: [{ role: "user", content: `מאת: ${input.from}\nנושא: ${input.subject}\nתקציר: ${input.snippet}` }],
      });
      const p = JSON.parse(res.text) as EmailClassification;
      return {
        category: p.category ?? "unknown",
        priority: p.priority ?? "normal",
        replyRequired: Boolean(p.replyRequired),
        summary: p.summary ?? "",
      };
    } catch {
      /* fall through to heuristics */
    }
  }

  // 3. heuristics
  const hay = `${input.from} ${input.subject} ${input.snippet}`.toLowerCase();
  let category: EmailCategory = "unknown";
  if (/newsletter|unsubscribe|דיוור|ניוזלטר/.test(hay)) category = "newsletter";
  else if (/invoice|receipt|חשבונית|קבלה|תשלום/.test(hay)) category = "invoice";
  else if (/הצעת מחיר|מעוניין|לפרטים|quote|interested|pricing|כמה עולה/.test(hay)) category = "lead";
  else if (/noreply|no-reply|notification|alert|מערכת/.test(hay)) category = "system";
  else category = "business";

  const priority: EmailClassification["priority"] = /דחוף|urgent|asap|מיידי/.test(hay)
    ? "urgent"
    : category === "lead"
      ? "high"
      : "normal";
  return {
    category,
    priority,
    replyRequired: category === "lead",
    summary: category === "lead" ? "ליד — כדאי לחזור עם תשובה ראשונית." : `מייל ${category}.`,
  };
}
