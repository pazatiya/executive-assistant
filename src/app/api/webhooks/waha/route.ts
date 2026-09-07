import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { parseInboundMessage } from "@/lib/integrations/waha";
import { ingestWhatsAppMessage } from "@/lib/agents/inbound-pipeline";

export const dynamic = "force-dynamic";

function secretOk(req: Request): boolean {
  const expected = env.wahaWebhookSecret;
  if (!expected) return false; // fail closed
  const url = new URL(req.url);
  const provided = url.searchParams.get("secret") ?? req.headers.get("x-webhook-secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Inbound WhatsApp via self-hosted WAHA — customer messages only.
 *
 * There is no owner command channel: the owners never text the assistant. All
 * management happens in the app. Messages the assistant sends itself (fromMe),
 * group messages, and empty messages are dropped by the shared pipeline.
 */
export async function POST(req: Request) {
  if (!secretOk(req)) return new Response("unauthorized", { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const result = await ingestWhatsAppMessage(parseInboundMessage(body));
  if (!result.ok) return Response.json(result, { status: 503 });
  return Response.json(result);
}

export async function GET() {
  return Response.json({ ok: true, service: "waha-webhook" });
}
