/**
 * WhatsApp via self-hosted WAHA (WhatsApp HTTP API over WhatsApp Web).
 *
 * No Meta Cloud API, no third-party relay — a local Docker container the user
 * links once (see ~/.claude/skills/whatsapp-self). This connector speaks the
 * same HTTP surface `wa.py` uses: X-Api-Key header, /api/sendText, session
 * endpoints, and the `message` webhook event.
 */
import { env } from "@/lib/env";
import { BaseConnector, type Capability, type Connector, type ConnectorActionResult } from "./connector";

const cap = (key: string, label: string, risk: Capability["risk"]): Capability => ({ key, label, risk });

export function wahaConfigured(): boolean {
  return Boolean(env.wahaApiKey);
}

/** Phone/JID → WAHA chatId. Mirrors normalize_chat_id in wa.py. */
export function normalizeChatId(raw: string): string {
  const s = String(raw);
  if (s.endsWith("@c.us") || s.endsWith("@g.us")) return s;
  let digits = s.replace(/\D/g, "");
  if (digits.startsWith("0") && env.waCountryCode) digits = env.waCountryCode + digits.slice(1);
  return `${digits}@c.us`;
}

/** Bare number for display / matching (strip @c.us, leading +). */
export function chatIdToNumber(chatId: string): string {
  return chatId.split("@")[0].replace(/\D/g, "");
}

type WahaResult<T> = { status: number | null; body: T | null };

/** Base URL, tolerating a schemeless host:port (Render private networking). */
function wahaBase(): string {
  const b = env.wahaBaseUrl.trim();
  return /^https?:\/\//.test(b) ? b : `http://${b}`;
}

async function wahaFetch<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<WahaResult<T>> {
  const url = `${wahaBase()}${path}`;
  const headers: Record<string, string> = { "X-Api-Key": env.wahaApiKey };
  let payload: string | undefined;
  if (opts.body !== undefined) {
    payload = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json";
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? (opts.body ? "POST" : "GET"),
      headers,
      body: payload,
      signal: controller.signal,
    });
    const text = await res.text();
    let body: T | null = null;
    try {
      body = text ? (JSON.parse(text) as T) : null;
    } catch {
      body = text as unknown as T;
    }
    return { status: res.status, body };
  } catch {
    return { status: null, body: null };
  } finally {
    clearTimeout(timer);
  }
}

interface SessionInfo {
  name: string;
  status: string; // WORKING | SCAN_QR_CODE | STARTING | FAILED | STOPPED
  me?: { id: string; pushName?: string } | null;
}

export async function getSession(): Promise<SessionInfo | null> {
  const { body } = await wahaFetch<SessionInfo>(`/api/sessions/${env.wahaSession}`);
  return body ?? null;
}

export async function getConnectedNumber(): Promise<string | null> {
  const { body } = await wahaFetch<{ id?: string; pushName?: string }>(
    `/api/sessions/${env.wahaSession}/me`,
  );
  if (body?.id) return chatIdToNumber(body.id);
  // older WAHA builds only expose `me` on the session object
  const s = await getSession();
  return s?.me?.id ? chatIdToNumber(s.me.id) : null;
}

/** The URL WAHA should POST events to. */
export function webhookTargetUrl(): string {
  if (env.wahaWebhookUrl) return env.wahaWebhookUrl;
  const q = env.wahaWebhookSecret ? `?secret=${encodeURIComponent(env.wahaWebhookSecret)}` : "";
  const appUrl = env.appUrl;
  // local dev with a Docker WAHA → the container reaches the host at host.docker.internal
  if (/localhost|127\.0\.0\.1/.test(appUrl)) {
    const port = new URL(appUrl).port || "4310";
    return `http://host.docker.internal:${port}/api/webhooks/waha${q}`;
  }
  // deployed → the public app URL
  return `${appUrl.replace(/\/$/, "")}/api/webhooks/waha${q}`;
}

/** Point the WAHA session at our webhook for inbound `message` events. */
export async function registerWebhook(): Promise<{ ok: boolean; detail: string }> {
  const url = webhookTargetUrl();
  const { status } = await wahaFetch(`/api/sessions/${env.wahaSession}`, {
    method: "PUT",
    body: {
      config: {
        webhooks: [{ url, events: ["message"], hmac: null, retries: null, customHeaders: null }],
      },
    },
  });
  if (status && status >= 200 && status < 300) return { ok: true, detail: `webhook → ${url}` };
  return { ok: false, detail: `WAHA session update failed (HTTP ${status ?? "no response"})` };
}

export interface InboundMessage {
  externalId: string;
  fromChatId: string;
  fromNumber: string;
  authorName: string | null;
  text: string;
  receivedAt: string;
  fromMe: boolean;
  isGroup: boolean;
  /** Present only for an image message (Meta Cloud API) — its media id, re-fetchable/forwardable via send_image_to_customer. */
  mediaId?: string;
}

/** Parse a WAHA `message` webhook body into our shape, or null if not a usable DM. */
export function parseInboundMessage(raw: unknown): InboundMessage | null {
  const evt = raw as {
    event?: string;
    payload?: {
      id?: string;
      timestamp?: number;
      from?: string;
      fromMe?: boolean;
      body?: string;
      caption?: string;
      type?: string;
      _data?: { notifyName?: string; Info?: { PushName?: string } };
      notifyName?: string;
    };
  };
  if (evt.event !== "message" || !evt.payload) return null;
  const p = evt.payload;
  const from = String(p.from ?? "");
  if (!from) return null;
  const text = (p.body ?? p.caption ?? "").trim();
  return {
    externalId: String(p.id ?? `${from}:${p.timestamp ?? Date.now()}`),
    fromChatId: from,
    fromNumber: chatIdToNumber(from),
    authorName: p._data?.notifyName ?? p._data?.Info?.PushName ?? p.notifyName ?? null,
    text,
    receivedAt: p.timestamp ? new Date(p.timestamp * 1000).toISOString() : new Date().toISOString(),
    fromMe: Boolean(p.fromMe),
    isGroup: from.endsWith("@g.us"),
  };
}

export class WahaConnector extends BaseConnector {
  provider = "whatsapp";
  displayName = "WhatsApp";
  category = "messaging" as const;

  listCapabilities() {
    return [
      cap("read_messages", "קריאת הודעות", "green"),
      cap("send_message", "שליחת הודעה", "yellow"),
    ];
  }

  async connect() {
    if (!wahaConfigured())
      return { message: "WAHA לא מוגדר. הוסיפו WAHA_API_KEY ל-.env.local (מ-~/.claude/skills/whatsapp-self/.env)." };
    const s = await getSession();
    if (!s) return { message: "אין תגובה מ-WAHA. הריצו: python3 ~/.claude/skills/whatsapp-self/wa.py ensure-up" };
    if (s.status !== "WORKING")
      return {
        message: `WhatsApp לא מקושר (מצב: ${s.status}). הריצו: python3 ~/.claude/skills/whatsapp-self/wa.py connect`,
      };
    return { redirectUrl: "/api/integrations/whatsapp/connect", message: "WAHA מחובר — מפעיל webhook…" };
  }

  async testConnection() {
    if (!wahaConfigured()) return { ok: false, detail: "WAHA_API_KEY חסר" };
    const s = await getSession();
    if (!s) return { ok: false, detail: "אין תגובה מ-WAHA (הריצו wa.py ensure-up)" };
    if (s.status !== "WORKING") return { ok: false, detail: `session במצב ${s.status}` };
    const num = await getConnectedNumber();
    return { ok: true, detail: num ? `מחובר: ${num}` : "מחובר" };
  }

  async fetchData(resource: string, params: Record<string, unknown> = {}) {
    if (!wahaConfigured()) return { ok: false, items: [], detail: "לא מחובר" };
    const limit = Number(params.limit ?? 20);
    if (resource === "chats") {
      const { body } = await wahaFetch<unknown[]>(
        `/api/${env.wahaSession}/chats/overview?limit=${limit}`,
      );
      return { ok: Array.isArray(body), items: Array.isArray(body) ? body : [] };
    }
    if (resource === "messages") {
      const chatId = params.chatId ? normalizeChatId(String(params.chatId)) : null;
      if (!chatId) return { ok: false, items: [], detail: "chatId נדרש" };
      const enc = chatId.replace(/@/g, "%40");
      const { body } = await wahaFetch<unknown>(
        `/api/${env.wahaSession}/chats/${enc}/messages?limit=${limit}&downloadMedia=false`,
      );
      const items = Array.isArray(body)
        ? body
        : body && typeof body === "object" && Array.isArray((body as { messages?: unknown[] }).messages)
          ? (body as { messages: unknown[] }).messages
          : [];
      return { ok: true, items };
    }
    return { ok: false, items: [], detail: `resource לא נתמך: ${resource}` };
  }

  async executeAction(action: string, payload: Record<string, unknown>): Promise<ConnectorActionResult> {
    if (!wahaConfigured()) return { ok: false, detail: "", error: "WhatsApp לא מחובר" };
    if (action === "send_message" || action === "reply_message") {
      const to = normalizeChatId(String(payload.to ?? payload.chatId ?? ""));
      const text = String(payload.text ?? payload.body ?? "");
      if (!to || !text) return { ok: false, detail: "", error: "חסר נמען או טקסט" };
      const { status } = await wahaFetch(`/api/sendText`, {
        body: { session: env.wahaSession, chatId: to, text },
      });
      if (status && (status === 200 || status === 201))
        return { ok: true, detail: "ההודעה נשלחה בוואטסאפ", data: { chatId: to } };
      return { ok: false, detail: "", error: `WAHA sendText נכשל (HTTP ${status ?? "no response"})` };
    }
    return { ok: false, detail: "", error: `פעולה לא נתמכת: ${action}` };
  }

  async webhookHandler(payload: unknown) {
    const msg = parseInboundMessage(payload);
    return { ok: Boolean(msg), handled: msg ? "message" : "ignored" };
  }
}

export function makeWahaConnector(provider: string, _integrationId: string | null): Connector | null {
  if (provider === "whatsapp") return new WahaConnector();
  return null;
}
