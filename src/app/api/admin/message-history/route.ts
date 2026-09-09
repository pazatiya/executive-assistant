import { desc, eq } from "drizzle-orm";
import { apiContext } from "@/lib/api";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** One-off diagnostic: how many message rows exist for a given phone number,
 * to check whether isFirstContact's "was this really their first message"
 * read matches reality. Open once from a logged-in browser, then delete. */
export async function GET(req: Request) {
  await apiContext(req);
  const phone = new URL(req.url).searchParams.get("phone");
  if (!phone) return Response.json({ error: "missing ?phone=" }, { status: 400 });
  const rows = await db.query.messages.findMany({
    where: eq(messages.authorHandle, phone),
    orderBy: desc(messages.receivedAt),
    limit: 10,
  });
  return Response.json({
    count: rows.length,
    rows: rows.map((r) => ({ id: r.id, channel: r.channel, text: r.text.slice(0, 60), receivedAt: r.receivedAt, createdAt: r.createdAt })),
  });
}
