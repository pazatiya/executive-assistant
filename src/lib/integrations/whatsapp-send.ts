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
