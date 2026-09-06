import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { parseInboundMessage } from "@/lib/integrations/waha";
import { resolveWhatsAppTarget } from "@/lib/integrations/whatsapp-context";
import { createInboundMessage, findMessageByExternalId, updateMessage } from "@/lib/services/messages";
import { triageMessage } from "@/lib/agents/message-triage";
import { respondToMessage } from "@/lib/agents/message-responder";
import { handleOwnerCommand } from "@/lib/agents/owner-commands";
import { handleOwnerNote, resolveOwnerUser } from "@/lib/agents/owner-note";
import { isOwnerNumber, notifyOwners, ownerNumbers } from "@/lib/services/notify-owner";
import { WahaConnector, normalizeChatId } from "@/lib/integrations/waha";
import { runAutomations } from "@/lib/automation/engine";

export const dynamic = "force-dynamic";

function secretOk(req: Request): boolean {
  const expected = env.wahaWebhookSecret;
  if (!expected) return false; // fail closed — a secret must be configured
  const url = new URL(req.url);
  const provided = url.searchParams.get("secret") ?? req.headers.get("x-webhook-secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Inbound WhatsApp events from the local WAHA container.
 * Auth: shared secret (?secret= or X-Webhook-Secret) — WAHA has no signing on
 * the WEBJS engine, so the secret is the whole gate. Fails closed.
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
  if (msg.isGroup || !msg.text) return Response.json({ ok: true, handled: "skipped" });

  // ── owner command channel ────────────────────────────────────────────
  // A message from an owner (self-chat, or one of OWNER_WHATSAPP) may be a
  // command like "אשר A7". Customers can never reach this path.
  const fromOwner = msg.fromMe || isOwnerNumber(msg.fromNumber);
  if (fromOwner) {
    const replyToOwner = async (text: string) => {
      const waha = new WahaConnector();
      const to = msg.fromMe ? null : normalizeChatId(msg.fromNumber);
      if (to) await waha.executeAction("send_message", { to, text }).catch(() => {});
      else if (ownerNumbers().length) await notifyOwners(text).catch(() => {});
    };

    const cmd = await handleOwnerCommand(msg.text, msg.fromMe ? "בעלים" : msg.fromNumber);
    if (cmd.isCommand) {
      if (cmd.reply) await replyToOwner(cmd.reply);
      return Response.json({ ok: true, handled: "owner_command" });
    }

    // not a command → treat as a self-note: reminder / task
    const ownerUserId = await resolveOwnerUser(msg.fromNumber, msg.fromMe);
    if (ownerUserId) {
      const note = await handleOwnerNote(msg.text, ownerUserId).catch(() => ({ handled: false }) as const);
      if (note.handled) {
        if (note.reply) await replyToOwner(note.reply);
        return Response.json({ ok: true, handled: "owner_note" });
      }
    }
    return Response.json({ ok: true, handled: "skipped_owner" });
  }
  if (msg.fromMe) return Response.json({ ok: true, handled: "skipped" });

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

  // triage → classify the row
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

  // decide: auto-reply (whitelisted routine) or raise an approval
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

  // let automation rules react too (e.g. complaint → urgent task)
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
    outcome: responded?.action ?? "logged_only",
  });
}

// WAHA sometimes probes the URL with GET
export async function GET() {
  return Response.json({ ok: true, service: "waha-webhook" });
}
