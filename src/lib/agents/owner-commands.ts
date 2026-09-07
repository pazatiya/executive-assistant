/**
 * Owner commands over WhatsApp.
 *
 * A message from an owner's number (see OWNER_WHATSAPP) is a command, not a
 * customer enquiry. Quick verbs — status / approve / reject — are handled
 * directly; anything else goes to the orchestrator as that owner, and its
 * reply is sent back over WhatsApp. The app stays the primary control room;
 * this is the on-the-go layer.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, workspaces } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { listApprovals, decideApproval } from "@/lib/services/approvals";
import { getOrCreateConversation } from "@/lib/services/conversations";
import { orchestrate } from "@/lib/agents/orchestrator";

const APPROVE = /^(אשר|מאשר|אשרי|approve|ok|כן)\s+([a-z0-9]{3,})$/i;
const REJECT = /^(דחה|דחי|לא|reject|בטל)\s+([a-z0-9]{3,})$/i;
const STATUS = /^(סטטוס|status|מה קורה|מה יש|pending|ממתין)\s*$/i;

async function dalorWorkspaceId(): Promise<string | null> {
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, env.whatsappWorkspaceSlug) });
  return ws?.id ?? null;
}

function matchApproval<T extends { id: string }>(rows: T[], token: string): T | undefined {
  const t = token.toLowerCase();
  return (
    rows.find((r) => r.id.toLowerCase().endsWith(t)) ??
    rows.find((r) => r.id.toLowerCase().includes(t))
  );
}

/** Returns the text to send back to the owner. */
export async function handleOwnerCommand(ownerUserId: string, text: string): Promise<string> {
  const body = text.trim();
  const wsId = await dalorWorkspaceId();

  // ── status ──────────────────────────────────────────────────────
  if (STATUS.test(body)) {
    const pending = await listApprovals(ownerUserId, {
      statuses: ["pending"],
      limit: 10,
      ...(wsId ? { workspaceId: wsId } : {}),
    });
    if (!pending.length) return "אין אישורים ממתינים ✅";
    return (
      "🔴 ממתין לאישור:\n" +
      pending
        .map((a) => `• ${a.title}\n   ${a.preview || a.context}\n   → אשר ${a.id.slice(-4)} / דחה ${a.id.slice(-4)}`)
        .join("\n")
    );
  }

  // ── approve / reject <id-tail> ──────────────────────────────────
  const ap = APPROVE.exec(body);
  const rj = REJECT.exec(body);
  if (ap || rj) {
    const token = (ap ?? rj)![2];
    const pending = await listApprovals(ownerUserId, {
      statuses: ["pending"],
      limit: 25,
      ...(wsId ? { workspaceId: wsId } : {}),
    });
    const target = matchApproval(pending, token);
    if (!target) return `לא מצאתי אישור ממתין עם "${token}". שלח "סטטוס" לרשימה.`;
    const owner = await db.query.users.findFirst({ where: eq(users.id, ownerUserId) });
    const r = await decideApproval(ownerUserId, target.id, ap ? "approve" : "reject", {
      decidedBy: owner?.fullName ?? "בעלים",
    });
    if (!r.ok) return r.error === "not_found" ? "האישור לא נמצא." : `כבר טופל (${r.error}).`;
    return ap ? `✅ אושר: ${target.title}` : `❌ נדחה: ${target.title}`;
  }

  // ── everything else → the orchestrator, as this owner ───────────
  if (!wsId) return "לא מצאתי את סביבת DALOR. נסה מהאפליקציה.";
  const conv = await getOrCreateConversation(ownerUserId, null, wsId);
  try {
    const result = await orchestrate({
      userId: ownerUserId,
      workspaceId: wsId,
      conversationId: conv.id,
      message: body,
    });
    return result.reply || "טופל 👍";
  } catch (e) {
    console.error("owner command orchestrate failed", e);
    return "משהו השתבש אצלי — נסה שוב, או מהאפליקציה.";
  }
}
