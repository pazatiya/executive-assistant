import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { emails, messages } from "@/lib/db/schema";
import { listScope } from "@/lib/auth/scope";
import { apiContext, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { user } = await apiContext(req);
  const [emailScope, msgScope] = await Promise.all([
    listScope({ userId: emails.userId, workspaceId: emails.workspaceId }, user.id),
    listScope({ userId: messages.userId, workspaceId: messages.workspaceId }, user.id),
  ]);
  const [em, ms] = await Promise.all([
    db.select().from(emails).where(emailScope).orderBy(desc(emails.receivedAt)).limit(100),
    db.select().from(messages).where(msgScope).orderBy(desc(messages.receivedAt)).limit(100),
  ]);
  return ok({ emails: em, messages: ms });
}
