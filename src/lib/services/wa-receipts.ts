import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { waReceipts } from "@/lib/db/schema";
import type { MetaStatusEvent } from "@/lib/integrations/meta-whatsapp";

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";
const RANK: Record<DeliveryStatus, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

/** Store a Meta status event. Status only moves forward (Meta can deliver events out of order). */
export async function recordReceipt(ev: MetaStatusEvent) {
  const existing = await db.query.waReceipts.findFirst({ where: eq(waReceipts.wamid, ev.wamid) });
  const at = ev.at ?? new Date().toISOString();
  if (!existing) {
    // two status events for the same message can arrive at the same instant — the loser is harmless
    await db
      .insert(waReceipts)
      .values({
        wamid: ev.wamid,
        toNumber: ev.to.replace(/\D/g, ""),
        status: ev.status,
        errorSummary: ev.errorSummary ?? null,
        statusAt: at,
      })
      .onConflictDoNothing();
    return;
  }
  if (RANK[ev.status] <= RANK[existing.status]) return;
  await db
    .update(waReceipts)
    .set({ status: ev.status, errorSummary: ev.errorSummary ?? null, statusAt: at, updatedAt: new Date().toISOString() })
    .where(eq(waReceipts.wamid, ev.wamid));
}

/** Latest outbound receipt per customer number (numbers digits-only). */
export async function latestReceiptsFor(numbers: string[]) {
  const uniq = [...new Set(numbers.map((n) => n.replace(/\D/g, "")).filter(Boolean))];
  if (!uniq.length) return new Map<string, { status: DeliveryStatus; at: string; error: string | null }>();
  // table may not exist yet on a DB that hasn't been pushed — never break the inbox over it
  const rows = await db
    .select()
    .from(waReceipts)
    .where(inArray(waReceipts.toNumber, uniq))
    .orderBy(desc(waReceipts.createdAt))
    .catch(() => []);
  const out = new Map<string, { status: DeliveryStatus; at: string; error: string | null }>();
  for (const r of rows) if (!out.has(r.toNumber)) out.set(r.toNumber, { status: r.status, at: r.statusAt, error: r.errorSummary });
  return out;
}
