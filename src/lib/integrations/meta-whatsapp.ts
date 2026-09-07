/**
 * WhatsApp via the official Meta Cloud API (WhatsApp Business Platform).
 *
 * No third-party bridge, no ban risk. Inbound messages arrive as Meta webhook
 * events (`entry[].changes[].value.messages[]`); we reply with a POST to
 * graph.facebook.com. User-initiated "service" conversations are free.
 *
 * Setup: a Meta app with the WhatsApp product, a registered phone number, a
 * permanent access token, and the webhook pointed at /api/webhooks/meta with
 * our META_WA_VERIFY_TOKEN. See DEPLOY.md.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { chatIdToNumber, type InboundMessage } from "./waha";

export function metaWaConfigured(): boolean {
  return Boolean(env.metaWaToken && env.metaWaPhoneNumberId);
}

const graphBase = () => `https://graph.facebook.com/${env.metaGraphVersion}`;

/** Verify the X-Hub-Signature-256 header against the raw request body. */
export function verifyMetaSignature(rawBody: string, header: string | null): boolean {
  if (!env.metaAppSecret) return false; // fail closed
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", env.metaAppSecret).update(rawBody).digest("hex");
  const a = Buffer.from(header.slice("sha256=".length));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The GET webhook-verification handshake Meta performs once on save. */
export function metaVerifyChallenge(url: URL): string | null {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === env.metaWaVerifyToken) return challenge ?? "";
  return null;
}

interface MetaWebhook {
  entry?: {
    changes?: {
      value?: {
        contacts?: { profile?: { name?: string }; wa_id?: string }[];
        messages?: {
          id?: string;
          from?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          button?: { text?: string };
          interactive?: {
            button_reply?: { title?: string };
            list_reply?: { title?: string };
          };
        }[];
      };
    }[];
  }[];
}

/** Parse the first usable inbound text message from a Meta webhook body. */
export function parseMetaInbound(raw: unknown): InboundMessage | null {
  const evt = raw as MetaWebhook;
  for (const entry of evt.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const m = value?.messages?.[0];
      if (!m || !m.from) continue;
      const text =
        m.text?.body ??
        m.button?.text ??
        m.interactive?.button_reply?.title ??
        m.interactive?.list_reply?.title ??
        "";
      const contact = value?.contacts?.find((c) => c.wa_id === m.from) ?? value?.contacts?.[0];
      return {
        externalId: String(m.id ?? `${m.from}:${m.timestamp ?? Date.now()}`),
        fromChatId: `${chatIdToNumber(m.from)}@c.us`,
        fromNumber: chatIdToNumber(m.from),
        authorName: contact?.profile?.name ?? null,
        text: text.trim(),
        receivedAt: m.timestamp
          ? new Date(Number(m.timestamp) * 1000).toISOString()
          : new Date().toISOString(),
        fromMe: false, // Meta never delivers our own outbound as an inbound message
        isGroup: false, // the Cloud API has no group messaging
      };
    }
  }
  return null;
}

/** Send a plain-text WhatsApp message. `to` may be any phone format. */
export async function sendViaMeta(to: string, text: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!metaWaConfigured()) return { ok: false, error: "Meta WhatsApp לא מוגדר" };
  const number = chatIdToNumber(to);
  try {
    const res = await fetch(`${graphBase()}/${env.metaWaPhoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.metaWaToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: number,
        type: "text",
        text: { body: text, preview_url: false },
      }),
    });
    const body = (await res.json().catch(() => null)) as
      | { messages?: { id?: string }[]; error?: { message?: string } }
      | null;
    if (!res.ok) return { ok: false, error: body?.error?.message ?? `HTTP ${res.status}` };
    return { ok: true, id: body?.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
