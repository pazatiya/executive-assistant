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
/** True when this number wrote to us within the last 24h (free-text window is open). */
async function hasOpenWindow(number: string): Promise<boolean> {
  const [{ db }, { messages }, { and, eq, gte }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/db/schema"),
    import("drizzle-orm"),
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
  return !!recentInbound;
}

export async function sendWhatsAppWindowAware(
  to: string,
  text: string,
  name?: string | null,
): Promise<{ ok: boolean; providerId?: string; via: string; error?: string }> {
  if (!metaWaConfigured()) return sendWhatsApp(to, text);
  const { chatIdToNumber } = await import("./waha");
  const number = chatIdToNumber(to);
  const { env } = await import("@/lib/env");
  if (await hasOpenWindow(number)) return sendWhatsApp(to, text);
  const { sendMetaTemplateNamed } = await import("./meta-whatsapp");
  const r = await sendMetaTemplateNamed(env.metaOwnerMessageTemplate, number, [name?.trim() || "שלום", text]);
  return { ok: r.ok, providerId: r.id, via: "meta-template", error: r.error };
}

/** "2026-10-12" -> "12/10/2026" (the format the booking templates were approved with). */
function formatDateIl(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : date;
}

/**
 * Booking confirmation to the customer. Inside the 24h window the plain text is
 * fine; outside it (e.g. booked on behalf of a customer who wrote days ago) Meta
 * only delivers the approved `dalor_booking_confirm` template:
 * {{1}}=first name, {{2}}=date, {{3}}=time, {{4}}=service.
 */
export async function sendBookingConfirmation(input: {
  to: string;
  name?: string | null;
  date: string;
  time: string;
  service?: string | null;
  fallbackText: string;
}): Promise<{ ok: boolean; providerId?: string; via: string; error?: string }> {
  if (!metaWaConfigured()) return sendWhatsApp(input.to, input.fallbackText);
  const { chatIdToNumber } = await import("./waha");
  const number = chatIdToNumber(input.to);
  if (await hasOpenWindow(number)) return sendWhatsApp(input.to, input.fallbackText);
  const [{ sendMetaTemplateNamed }, { env }] = await Promise.all([import("./meta-whatsapp"), import("@/lib/env")]);
  const first = (input.name || "").trim().split(/\s+/)[0] || "לקוח יקר";
  const r = await sendMetaTemplateNamed(env.metaBookingConfirmTemplate, number, [
    first,
    formatDateIl(input.date),
    input.time,
    input.service?.trim() || "תספורת",
  ]);
  return { ok: r.ok, providerId: r.id, via: "meta-template", error: r.error };
}

/**
 * Cancellation confirmation after the customer asked the secretary to cancel.
 * Same window logic as the booking confirmation; outside the window the approved
 * `dalor_booking_cancel_confirm` template is used: {{1}}=name, {{2}}=date, {{3}}=time.
 */
export async function sendBookingCancelConfirmation(input: {
  to: string;
  name?: string | null;
  date: string;
  time: string;
  fallbackText: string;
}): Promise<{ ok: boolean; providerId?: string; via: string; error?: string }> {
  if (!metaWaConfigured()) return sendWhatsApp(input.to, input.fallbackText);
  const { chatIdToNumber } = await import("./waha");
  const number = chatIdToNumber(input.to);
  if (await hasOpenWindow(number)) return sendWhatsApp(input.to, input.fallbackText);
  const [{ sendMetaTemplateNamed }, { env }] = await Promise.all([import("./meta-whatsapp"), import("@/lib/env")]);
  const first = (input.name || "").trim().split(/\s+/)[0] || "לקוח יקר";
  const r = await sendMetaTemplateNamed(env.metaBookingCancelConfirmTemplate, number, [
    first,
    formatDateIl(input.date),
    input.time,
  ]);
  return { ok: r.ok, providerId: r.id, via: "meta-template", error: r.error };
}
