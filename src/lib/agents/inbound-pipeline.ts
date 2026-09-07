/**
 * Shared inbound-customer-message pipeline.
 *
 * Both WhatsApp transports — self-hosted WAHA and the official Meta Cloud API —
 * parse their very different webhook payloads into an `InboundMessage` and then
 * hand it here. One place decides: dedup, triage, draft/auto-reply, automations.
 */
import type { InboundMessage } from "@/lib/integrations/waha";
import { resolveWhatsAppTarget } from "@/lib/integrations/whatsapp-context";
import { isOwnerNumber, ownerUserIdForNumber } from "@/lib/integrations/owners";
import { sendWhatsApp } from "@/lib/integrations/whatsapp-send";
import { handleOwnerCommand } from "@/lib/agents/owner-commands";
import { createInboundMessage, findMessageByExternalId, updateMessage } from "@/lib/services/messages";
import { triageMessage } from "@/lib/agents/message-triage";
import { respondToMessage } from "@/lib/agents/message-responder";
import { runAutomations } from "@/lib/automation/engine";

export type IngestResult =
  | { ok: true; handled: "ignored" | "skipped" | "duplicate" | "owner_command" }
  | { ok: false; handled: "no_target" }
  | { ok: true; handled: "message"; id: string; intent: string; outcome: string };

// Meta retries a webhook if we're slow to 200 — the owner-command path (which
// runs the orchestrator, ~20s) can be hit twice. Short-lived per-process guard.
const seen = new Map<string, number>();
function alreadySeen(id: string): boolean {
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > 5 * 60_000) seen.delete(k);
  if (seen.has(id)) return true;
  seen.set(id, now);
  return false;
}

export async function ingestWhatsAppMessage(msg: InboundMessage | null): Promise<IngestResult> {
  if (!msg) return { ok: true, handled: "ignored" };
  if (msg.isGroup || !msg.text || msg.fromMe) return { ok: true, handled: "skipped" };
  if (alreadySeen(msg.externalId)) return { ok: true, handled: "duplicate" };

  // A message from an owner's own number is a command, not a customer.
  if (isOwnerNumber(msg.fromNumber)) {
    const ownerId = await ownerUserIdForNumber(msg.fromNumber);
    if (ownerId) {
      const reply = await handleOwnerCommand(ownerId, msg.text);
      await sendWhatsApp(msg.fromNumber, reply).catch(() => {});
      return { ok: true, handled: "owner_command" };
    }
  }

  const target = await resolveWhatsAppTarget();
  if (!target) return { ok: false, handled: "no_target" };

  const dup = await findMessageByExternalId("whatsapp", msg.externalId);
  if (dup) return { ok: true, handled: "duplicate" };

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

  return {
    ok: true,
    handled: "message",
    id: created.id,
    intent: triage.intent,
    outcome: responded?.action ?? "silent",
  };
}
