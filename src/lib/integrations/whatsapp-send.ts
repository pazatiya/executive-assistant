/**
 * One place to send a customer WhatsApp message, regardless of transport.
 * Meta Cloud API wins when it's configured (official, no ban risk); otherwise
 * we fall back to the self-hosted WAHA bridge.
 */
import { metaWaConfigured, sendViaMeta } from "./meta-whatsapp";
import { WahaConnector, normalizeChatId } from "./waha";

export async function sendWhatsApp(
  to: string,
  text: string,
): Promise<{ ok: boolean; providerId?: string; via: "meta" | "waha"; error?: string }> {
  if (metaWaConfigured()) {
    const r = await sendViaMeta(to, text);
    return { ok: r.ok, providerId: r.id, via: "meta", error: r.error };
  }
  const r = await new WahaConnector().executeAction("send_message", { to: normalizeChatId(to), text });
  return {
    ok: r.ok,
    providerId: (r.data?.chatId as string) ?? undefined,
    via: "waha",
    error: r.error,
  };
}

/**
 * Owner-dictated message to a customer/contact. WhatsApp allows free text only
 * within 24h of the customer's last message; outside that window Meta rejects it
 * (error 131047) *after* accepting the request, so it looks sent but never arrives.
 * Outside the window we wrap the text in the approved `dalor_note` template.
 */
export async function sendWhatsAppWindowAware(
  to: string,
  text: string,
  name?: string | null,
): Promise<{ ok: boolean; providerId?: string; via: string; error?: string }> {
  if (!metaWaConfigured()) return sendWhatsApp(to, text);
  const { chatIdToNumber } = await import("./waha");
  const number = chatIdToNumber(to);
  const [{ db }, { messages }, { and, eq, gte }, { env }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/db/schema"),
    import("drizzle-orm"),
    import("@/lib/env"),
  ]);
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  const recentInbound = await db.query.messages.findFirst({
    where: and(
      eq(messages.channel, "whatsapp"),
      eq(messages.authorHandle, number),
      eq(messages.source, "live"),
      gte(messages.receivedAt, dayAgo),
    ),
  });
  if (recentInbound) return sendWhatsApp(to, text);
  const { sendMetaTemplateNamed } = await import("./meta-whatsapp");
  const r = await sendMetaTemplateNamed(env.metaOwnerMessageTemplate, number, [name?.trim() || "שלום", text]);
  return { ok: r.ok, providerId: r.id, via: "meta-template", error: r.error };
}
