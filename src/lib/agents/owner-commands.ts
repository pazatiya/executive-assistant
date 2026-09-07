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

// "אשר" / "אשר 2" / "מאשר" — optional 1-based index into the pending list
const APPROVE = /^(אשר|מאשר|אשרי|approve|לאשר)\s*(\d{1,2})?\s*$/i;
const REJECT = /^(דחה|דחי|reject|לדחות|תדחה)\s*(\d{1,2})?\s*$/i;
const STATUS = /^(סטטוס|status|מה קורה\??|מה יש\??|pending|ממתין|אישורים)\s*$/i;

async function dalorWorkspaceId(): Promise<string | null> {
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, env.whatsappWorkspaceSlug) });
  return ws?.id ?? null;
}

function listPendingText(pending: { title: string; preview: string; context: string }[]): string {
  return pending
    .map((a, i) => `${i + 1}. ${a.title}${a.preview || a.context ? `\n   ${a.preview || a.context}` : ""}`)
    .join("\n");
}

/** Returns the text to send back to the owner. */
export async function handleOwnerCommand(ownerUserId: string, text: string): Promise<string> {
  const body = text.trim();
  const wsId = await dalorWorkspaceId();
  const scope = wsId ? { workspaceId: wsId } : {};

  // ── status ──────────────────────────────────────────────────────
  if (STATUS.test(body)) {
    const pending = await listApprovals(ownerUserId, { statuses: ["pending"], limit: 10, ...scope });
    if (!pending.length) return "אין אישורים ממתינים ✅";
    const tail = pending.length === 1 ? '\n\nהשב "אשר" לאישור או "דחה" לדחייה.' : '\n\nהשב למשל "אשר 1" או "דחה 2".';
    return `🔴 ממתין לאישור (${pending.length}):\n${listPendingText(pending)}${tail}`;
  }

  // ── approve / reject [n] ───────────────────────────────────────
  const ap = APPROVE.exec(body);
  const rj = REJECT.exec(body);
  if (ap || rj) {
    const pending = await listApprovals(ownerUserId, { statuses: ["pending"], limit: 10, ...scope });
    if (!pending.length) return "אין כרגע מה לאשר ✅";
    const nStr = (ap ?? rj)![2];
    if (!nStr && pending.length > 1) {
      return `יש ${pending.length} אישורים ממתינים — איזה?\n${listPendingText(pending)}\n\nהשב "אשר 1", "אשר 2"…`;
    }
    const idx = nStr ? Number(nStr) - 1 : 0;
    const target = pending[idx];
    if (!target) return `אין אישור מספר ${nStr}. שלח "סטטוס" לרשימה מעודכנת.`;
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
