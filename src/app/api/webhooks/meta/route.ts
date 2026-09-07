import { env } from "@/lib/env";
import { metaVerifyChallenge, parseMetaInbound, verifyMetaSignature } from "@/lib/integrations/meta-whatsapp";
import { ingestWhatsAppMessage } from "@/lib/agents/inbound-pipeline";

export const dynamic = "force-dynamic";

/**
 * Official WhatsApp (Meta Cloud API) — customer messages only.
 * Same policy as the WAHA webhook: the assistant only answers customers; all
 * owner-side management happens in the app.
 */

// One-time verification handshake when the webhook URL is saved in the Meta app.
export async function GET(req: Request) {
  const challenge = metaVerifyChallenge(new URL(req.url));
  if (challenge === null) return new Response("forbidden", { status: 403 });
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new Response("bad signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const msg = parseMetaInbound(body);
  // status callbacks (delivered/read) and non-message events carry no `messages[]`
  if (!msg) return Response.json({ ok: true, handled: "ignored" });

  // Process in the background — the orchestrator (owner commands) can take ~20s
  // and Meta retries the webhook if we don't 200 within a few seconds.
  void ingestWhatsAppMessage(msg).catch((e) => console.error("ingest failed", e));
  return Response.json({ ok: true, handled: "accepted" });
}
