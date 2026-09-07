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
        metadata?: { display_phone_number?: string; phone_number_id?: string };
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
      // only act on messages to OUR business number — the portfolio may hold
      // other numbers (e.g. the booking bot) on the same webhook.
      const pnid = value?.metadata?.phone_number_id;
      if (env.metaWaPhoneNumberId && pnid && pnid !== env.metaWaPhoneNumberId) continue;
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

async function postMessage(payload: Record<string, unknown>): Promise<{ ok: boolean; id?: string; error?: string }> {
  const to = payload.to as string | undefined;
  if (!metaWaConfigured()) {
    console.error(`[meta-wa] not configured — dropped message to ${to}`);
    return { ok: false, error: "Meta WhatsApp לא מוגדר" };
  }
  try {
    const res = await fetch(`${graphBase()}/${env.metaWaPhoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.metaWaToken}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    });
    const body = (await res.json().catch(() => null)) as
      | { messages?: { id?: string }[]; error?: { message?: string } }
      | null;
    if (!res.ok) {
      const error = body?.error?.message ?? `HTTP ${res.status}`;
      console.error(`[meta-wa] send to ${to} FAILED (${payload.type}): ${error}`);
      return { ok: false, error };
    }
    console.log(`[meta-wa] send to ${to} ok (${payload.type}), id=${body?.messages?.[0]?.id}`);
    return { ok: true, id: body?.messages?.[0]?.id };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[meta-wa] send to ${to} threw: ${error}`);
    return { ok: false, error };
  }
}

/** Send a plain-text WhatsApp message. Only allowed inside the 24h service window. */
export async function sendViaMeta(to: string, text: string) {
  return postMessage({
    to: chatIdToNumber(to),
    type: "text",
    text: { body: text, preview_url: false },
  });
}

/**
 * Open a conversation with a customer who never messaged the bot (e.g. they
 * wrote to a private line). Meta requires an approved template for this.
 * `bodyParams` fill the template's {{1}}, {{2}}… in order.
 */
export async function sendMetaTemplate(to: string, bodyParams: string[] = []) {
  return postMessage({
    to: chatIdToNumber(to),
    type: "template",
    template: {
      name: env.metaOutreachTemplate,
      language: { code: env.metaTemplateLang },
      ...(bodyParams.length
        ? { components: [{ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: t })) }] }
        : {}),
    },
  });
}
