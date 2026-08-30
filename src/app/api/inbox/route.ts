import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { emails, messages } from "@/lib/db/schema";
import { apiContext, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { user } = await apiContext(req);
  const [em, ms] = await Promise.all([
    db.select().from(emails).where(eq(emails.userId, user.id)).orderBy(desc(emails.receivedAt)).limit(100),
    db.select().from(messages).where(eq(messages.userId, user.id)).orderBy(desc(messages.receivedAt)).limit(100),
  ]);
  return ok({ emails: em, messages: ms });
}
