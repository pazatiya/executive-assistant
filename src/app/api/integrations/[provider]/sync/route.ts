import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { emails } from "@/lib/db/schema";
import { apiContext, bad, ok } from "@/lib/api";
import { getConnector } from "@/lib/integrations/registry";
import { classifyEmail } from "@/lib/agents/email-agent";
import { runAutomations } from "@/lib/automation/engine";
import { id } from "@/lib/ids";
import { nowIso } from "@/lib/utils";
import { logActivity } from "@/lib/services/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { user, workspaceId } = await apiContext(req);
  const { provider } = await params;

  const connector = await getConnector(user.id, provider, null);
  if (!connector || connector.status !== "connected") return bad(`${provider} לא מחובר`, 400);

  if (provider !== "gmail") return bad("סנכרון נתמך כרגע רק ל-Gmail", 400);

  const res = await connector.fetchData("messages", { q: "in:inbox newer_than:14d", limit: 15 });
  if (!res.ok) return bad(res.detail ?? "fetch failed", 502);

  let imported = 0;
  for (const raw of res.items as {
    id: string;
    threadId: string;
    from: string;
    subject: string;
    date: string;
    snippet: string;
  }[]) {
    const existing = await db.query.emails.findFirst({
      where: and(eq(emails.userId, user.id), eq(emails.externalId, raw.id)),
    });
    if (existing) continue;

    const fromMatch = raw.from.match(/(.*?)\s*<(.+?)>/);
    const fromName = fromMatch ? fromMatch[1].replace(/"/g, "").trim() : null;
    const fromAddress = fromMatch ? fromMatch[2] : raw.from;

    const cls = await classifyEmail({ from: fromAddress, subject: raw.subject, snippet: raw.snippet, userId: user.id });
    const emailId = id("email");

    await db.insert(emails).values({
      id: emailId,
      userId: user.id,
      workspaceId,
      externalId: raw.id,
      threadId: raw.threadId,
      fromAddress,
      fromName,
      toAddresses: [user.email],
      subject: raw.subject,
      snippet: raw.snippet,
      bodyText: raw.snippet,
      receivedAt: raw.date ? new Date(raw.date).toISOString() : nowIso(),
      category: cls.category,
      priority: cls.priority,
      replyRequired: cls.replyRequired,
      aiSummary: cls.summary,
      status: "inbox",
      source: "gmail",
    });
    imported++;

    await runAutomations(user.id, "email.received", {
      workspaceId,
      emailId,
      category: cls.category,
      priority: cls.priority,
      from: fromAddress,
      subject: raw.subject,
      snippet: raw.snippet,
      targetSystem: "gmail",
    });
  }

  await logActivity({
    userId: user.id,
    workspaceId,
    agent: "email",
    action: `סנכרון Gmail — ${imported} מיילים חדשים`,
    tool: "gmail",
    result: "success",
  });

  return ok({ imported });
}
