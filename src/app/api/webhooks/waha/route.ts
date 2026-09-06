import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { parseInboundMessage } from "@/lib/integrations/waha";
import { resolveWhatsAppTarget } from "@/lib/integrations/whatsapp-context";
import { createInboundMessage, findMessageByExternalId, updateMessage } from "@/lib/services/messages";
import { triageMessage } from "@/lib/agents/message-triage";
import { respondToMessage } from "@/lib/agents/message-responder";
import { runAutomations } from "@/lib/automation/engine";

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
 * Inbound WhatsApp — customer messages only.
 *
 * There is no owner command channel: the owners never text the assistant. All
 * management happens in the app. Messages the assistant sends itself (fromMe),
 * group messages, and messages from an owner's own number are ignored here.
 */
export async function POST(req: Request) {
  if (!secretOk(req)) return new Response("unauthorized", { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const msg = parseInboundMessage(body);
  if (!msg) return Response.json({ ok: true, handled: "ignored" });
  if (msg.isGroup || !msg.text || msg.fromMe) {
    return Response.json({ ok: true, handled: "skipped" });
  }

  const target = await resolveWhatsAppTarget();
  if (!target) return Response.json({ ok: false, handled: "no_target" }, { status: 503 });

  const dup = await findMessageByExternalId("whatsapp", msg.externalId);
  if (dup) return Response.json({ ok: true, handled: "duplicate" });

  const created = await createInboundMessage({
    userId: target.userId,
    workspaceId: target.workspaceId,
    integrationId: target.integrationId,
    channel: "whatsapp",
    kind: "dm",
    externalId: msg.externalId,
    authorHandle: msg.fromNumber,
    authorName: msg.authorName,
    text: msg.text,
    receivedAt: msg.receivedAt,
    source: "live",
  });

  const triage = await triageMessage({
    text: msg.text,
    authorName: msg.authorName,
    channel: "whatsapp",
  });
  const classified =
    (await updateMessage(target.userId, created.id, {
      classification: triage.classification,
      sentiment: triage.sentiment,
      priority: triage.priority,
    })) ?? created;

  let responded: Awaited<ReturnType<typeof respondToMessage>> | null = null;
  try {
    responded = await respondToMessage({
      message: classified,
      triage,
      ownerUserId: target.userId,
      workspaceId: target.workspaceId,
    });
  } catch (e) {
    console.error("respondToMessage failed", e);
  }

  await runAutomations(target.userId, "message.received", {
    workspaceId: target.workspaceId,
    messageId: created.id,
    channel: "whatsapp",
    classification: triage.classification,
    sentiment: triage.sentiment,
    text: msg.text,
    from: msg.fromNumber,
    targetSystem: "whatsapp",
  }).catch(() => []);

  return Response.json({
    ok: true,
    handled: "message",
    id: created.id,
    intent: triage.intent,
    outcome: responded?.action ?? "silent",
  });
}

export async function GET() {
  return Response.json({ ok: true, service: "waha-webhook" });
}
