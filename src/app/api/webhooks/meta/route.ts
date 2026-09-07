import { env } from "@/lib/env";
import { metaVerifyChallenge, parseMetaInbound, parseMetaStatuses, verifyMetaSignature } from "@/lib/integrations/meta-whatsapp";
import { ingestWhatsAppMessage } from "@/lib/agents/inbound-pipeline";
import { resolveWhatsAppTarget } from "@/lib/integrations/whatsapp-context";
import { notifyOwnersOf } from "@/lib/services/notifications";

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

  // delivery/read receipts (and send failures) for messages we sent — logged
  // so "did it actually reach him" has a real answer, not just "we sent it".
  for (const s of parseMetaStatuses(body)) {
    if (s.status === "failed") {
      console.error(`[meta-wa] ✗ FAILED to=${s.to} wamid=${s.wamid}${s.errorSummary ? ` (${s.errorSummary})` : ""}`);
      // A send that looked ok at request time can still fail delivery
      // (invalid number, blocked, etc.) — that's silent otherwise, so ping
      // the owners rather than let it only exist in a log nobody reads.
      resolveWhatsAppTarget()
        .then((target) =>
          target
            ? notifyOwnersOf(target.workspaceId, {
                fallbackUserId: target.userId,
                kind: "proactive",
                title: `✗ הודעה לא הגיעה ל-${s.to}`,
                body: s.errorSummary || "השליחה נכשלה בפועל אחרי שנראתה מוצלחת בהתחלה.",
                priority: "high",
              })
            : undefined,
        )
        .catch(() => {});
    } else {
      console.log(`[meta-wa] ${s.status === "read" ? "✓✓ read" : s.status === "delivered" ? "✓✓ delivered" : "✓ sent"} to=${s.to} wamid=${s.wamid}`);
    }
  }

  const msg = parseMetaInbound(body);
  // status callbacks (delivered/read) and non-message events carry no `messages[]`
  if (!msg) return Response.json({ ok: true, handled: "ignored" });

  // Process in the background — the orchestrator (owner commands) can take ~20s
  // and Meta retries the webhook if we don't 200 within a few seconds.
  void ingestWhatsAppMessage(msg).catch((e) => console.error("ingest failed", e));
  return Response.json({ ok: true, handled: "accepted" });
}
