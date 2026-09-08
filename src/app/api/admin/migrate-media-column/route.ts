import { sql } from "drizzle-orm";
import { apiContext } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * One-off: adds messages.media_id (nullable) so inbound WhatsApp photos can be
 * displayed in the app — see the mediaId column added to schema.ts. Meant to
 * be opened once, by hand, from a logged-in owner's own browser (apiContext
 * requires that) — avoids ever needing the raw Turso credentials to run
 * `drizzle-kit push` from outside. Safe to hit more than once: it checks the
 * column exists first.
 */
export async function GET(req: Request) {
  await apiContext(req);
  const cols = await db.run(sql`PRAGMA table_info(messages)`);
  const exists = (cols.rows as unknown as { name: string }[]).some((c) => c.name === "media_id");
  if (exists) return Response.json({ ok: true, already: true });
  await db.run(sql`ALTER TABLE messages ADD COLUMN media_id TEXT`);
  return Response.json({ ok: true, already: false });
}
