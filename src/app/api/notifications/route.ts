import { desc, eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { apiContext, ok, readJson } from "@/lib/api";
import { nowIso } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await apiContext();
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(50);
  return ok({ items: rows, unread: rows.filter((r) => !r.readAt).length });
}

export async function POST(req: Request) {
  const { user } = await apiContext();
  const body = await readJson<{ action: "mark_all_read" }>(req);
  if (body.action === "mark_all_read") {
    await db
      .update(notifications)
      .set({ readAt: nowIso() })
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  }
  return ok({ ok: true });
}
