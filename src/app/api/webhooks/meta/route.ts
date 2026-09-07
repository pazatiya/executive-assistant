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

  // status callbacks (delivered/read) and non-message events carry no `messages[]`
  const result = await ingestWhatsAppMessage(parseMetaInbound(body));
  if (!result.ok) return Response.json(result, { status: 503 });
  // Always 200 to Meta once accepted, so it doesn't retry.
  return Response.json(result);
}
