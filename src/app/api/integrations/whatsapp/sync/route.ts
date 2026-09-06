import { db } from "@/lib/db";
import { integrations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { chatIdToNumber, wahaConfigured, WahaConnector } from "@/lib/integrations/waha";
import { resolveWhatsAppTarget } from "@/lib/integrations/whatsapp-context";
import { createInboundMessage, findMessageByExternalId } from "@/lib/services/messages";
import { nowIso } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Pull-based backfill for WhatsApp — a safety net for when the webhook drops a
 * message. Walks recent chats, imports any inbound DM we haven't seen.
 */
export async function POST() {
  await getCurrentUser();
  if (!wahaConfigured()) return Response.json({ ok: false, detail: "WAHA לא מוגדר" }, { status: 400 });

  const target = await resolveWhatsAppTarget();
  if (!target) return Response.json({ ok: false, detail: "אין יעד WhatsApp" }, { status: 503 });

  const waha = new WahaConnector();
  const chats = await waha.fetchData("chats", { limit: 20 });
  if (!chats.ok) return Response.json({ ok: false, detail: chats.detail ?? "fetch chats failed" }, { status: 502 });

  let imported = 0;
  for (const chat of chats.items as { id?: string | { _serialized?: string } }[]) {
    const rawId = typeof chat.id === "string" ? chat.id : chat.id?._serialized;
    if (!rawId || rawId.endsWith("@g.us")) continue;

    const msgs = await waha.fetchData("messages", { chatId: rawId, limit: 15 });
    if (!msgs.ok) continue;

    for (const m of msgs.items as {
      id?: string | { _serialized?: string; id?: string };
      fromMe?: boolean;
      body?: string;
      caption?: string;
      timestamp?: number;
      from?: string;
      _data?: { notifyName?: string };
    }[]) {
      if (m.fromMe) continue;
      const text = (m.body ?? m.caption ?? "").trim();
      if (!text) continue;
      const externalId =
        typeof m.id === "string" ? m.id : m.id?._serialized ?? m.id?.id ?? `${rawId}:${m.timestamp ?? ""}`;
      if (await findMessageByExternalId("whatsapp", externalId)) continue;

      await createInboundMessage({
        userId: target.userId,
        workspaceId: target.workspaceId,
        integrationId: target.integrationId,
        channel: "whatsapp",
        externalId,
        authorHandle: chatIdToNumber(m.from ?? rawId),
        authorName: m._data?.notifyName ?? null,
        text,
        receivedAt: m.timestamp ? new Date(m.timestamp * 1000).toISOString() : nowIso(),
        source: "live",
      });
      imported++;
    }
  }

  if (target.integrationId) {
    await db
      .update(integrations)
      .set({ lastSyncedAt: nowIso() })
      .where(eq(integrations.id, target.integrationId));
  }

  return Response.json({ ok: true, imported });
}
