/**
 * Owner commands over WhatsApp.
 *
 * A message from an owner's number (see OWNER_WHATSAPP) is a command, not a
 * customer enquiry. Quick verbs — status / approve / reject — are handled
 * directly; anything else goes to the orchestrator as that owner, and its
 * reply is sent back over WhatsApp. The app stays the primary control room;
 * this is the on-the-go layer.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, users, workspaces } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { listApprovals, decideApproval } from "@/lib/services/approvals";
import { getOrCreateConversation } from "@/lib/services/conversations";
import { orchestrate } from "@/lib/agents/orchestrator";

// "אשר" / "אשר 2" — optional 1-based index; "אשר הכל" / "אשר את כולם" — all
const ALL = /(הכל|כולם|את כולם|all)\s*$/i;
const APPROVE = /^(אשר|מאשר|אשרי|approve|לאשר)\s*(\d{1,2})?\s*(?:הכל|כולם|את כולם|all)?\s*$/i;
const REJECT = /^(דחה|דחי|reject|לדחות|תדחה)\s*(\d{1,2})?\s*(?:הכל|כולם|את כולם|all)?\s*$/i;
const STATUS = /^(סטטוס|status|מה קורה\??|מה יש\??|pending|ממתין|אישורים)\s*$/i;
const GREETING = /^(היי+|הי|שלום|אהלן|בוקר טוב|ערב טוב|מה נשמע|מה קורה|hey|hi|hello)[\s!.?]*$/i;

async function dalorWorkspaceId(): Promise<string | null> {
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, env.whatsappWorkspaceSlug) });
  return ws?.id ?? null;
}

/** The owner's own personal workspace — where "תזכיר לי" / private notes belong. */
async function personalWorkspaceId(ownerUserId: string): Promise<string | null> {
  const ws = await db.query.workspaces.findFirst({
    where: and(eq(workspaces.ownerId, ownerUserId), eq(workspaces.type, "personal")),
  });
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
  const owner = await db.query.users.findFirst({ where: eq(users.id, ownerUserId) });
  const firstName = (owner?.fullName ?? "").split(/\s+/)[0];

  // ── bare greeting → personal hello + what it can do ─────────────
  if (GREETING.test(body)) {
    return (
      `היי${firstName ? " " + firstName : ""} 🙂 מה לעשות בשבילך?\n` +
      "• תזכורת — \"תזכיר לי מחר ב-9 להתקשר לספק\"\n" +
      "• מייל / הודעה — \"תשלחי מייל ל...\"\n" +
      "• לחזור ללקוח — \"תחזרי ל-052... בקשר לחולצה\"\n" +
      "• בדיקה — \"מה התורים היום?\" / \"סטטוס\" (אישורים ממתינים)"
    );
  }

  // ── status ──────────────────────────────────────────────────────
  if (STATUS.test(body)) {
    const pending = await listApprovals(ownerUserId, { statuses: ["pending"], limit: 10, ...scope });
    if (!pending.length) return "אין אישורים ממתינים ✅";
    const tail = pending.length === 1 ? '\n\nהשב "אשר" לאישור או "דחה" לדחייה.' : '\n\nהשב למשל "אשר 1" או "דחה 2".';
    return `🔴 ממתין לאישור (${pending.length}):\n${listPendingText(pending)}${tail}`;
  }

  // ── approve / reject  [n] | "הכל" ──────────────────────────────
  const ap = APPROVE.exec(body);
  const rj = REJECT.exec(body);
  if (ap || rj) {
    const decision = ap ? ("approve" as const) : ("reject" as const);
    const verb = ap ? "אושר" : "נדחה";
    const pending = await listApprovals(ownerUserId, { statuses: ["pending"], limit: 25, ...scope });
    if (!pending.length) return ap ? "אין כרגע מה לאשר ✅" : "אין כרגע מה לדחות ✅";
    const owner = await db.query.users.findFirst({ where: eq(users.id, ownerUserId) });
    const decidedBy = owner?.fullName ?? "בעלים";
    const nStr = (ap ?? rj)![2];

    // "אשר הכל" / "דחה את כולם"
    if (!nStr && ALL.test(body)) {
      let done = 0;
      for (const a of pending) {
        const r = await decideApproval(ownerUserId, a.id, decision, { decidedBy });
        if (r.ok) done++;
      }
      return `${ap ? "✅" : "❌"} ${done}/${pending.length} ${verb} (הכל).`;
    }

    if (!nStr && pending.length > 1) {
      return `יש ${pending.length} אישורים ממתינים — איזה?\n${listPendingText(pending)}\n\nהשב "${ap ? "אשר" : "דחה"} 1" / "${ap ? "אשר" : "דחה"} 2" — או "${ap ? "אשר" : "דחה"} הכל".`;
    }
    const idx = nStr ? Number(nStr) - 1 : 0;
    const target = pending[idx];
    if (!target) return `אין אישור מספר ${nStr}. שלח "סטטוס" לרשימה מעודכנת.`;
    const r = await decideApproval(ownerUserId, target.id, decision, { decidedBy });
    if (!r.ok) return r.error === "not_found" ? "האישור לא נמצא." : `כבר טופל (${r.error}).`;
    return `${ap ? "✅" : "❌"} ${verb}: ${target.title}`;
  }

  // ── everything else → the orchestrator, as this owner ───────────
  // Default to the owner's PERSONAL workspace: "תזכיר לי", private notes and
  // "send me…" are personal. Business tools (customer replies, barber calendar)
  // reach the DALOR workspace on their own.
  const personalWs = (await personalWorkspaceId(ownerUserId)) ?? wsId;
  if (!personalWs) return "לא מצאתי סביבה מתאימה. נסה מהאפליקציה.";
  // Reuse the owner's most recent conversation in this workspace instead of
  // starting a fresh one on every WhatsApp message — otherwise a follow-up
  // like "972501234567" (answering "which Avi?") arrives with zero history
  // and reads as a random number out of nowhere.
  const existing = await db.query.conversations.findFirst({
    where: and(eq(conversations.userId, ownerUserId), eq(conversations.workspaceId, personalWs)),
    orderBy: desc(conversations.lastMessageAt),
  });
  const conv = await getOrCreateConversation(ownerUserId, existing?.id ?? null, personalWs);
  try {
    const result = await orchestrate({
      userId: ownerUserId,
      workspaceId: personalWs,
      conversationId: conv.id,
      message: `[הנחיה פנימית, לא לצטט או להזכיר אותה בתשובה: הכותב/ת פונה/ה אליך ישירות בוואטסאפ האישי שלה/ו. פני תמיד ` +
        `בגוף שני ("את"/"אתה") — לעולם לא בשם או בגוף שלישי כמו "${firstName || "הבעלים"}", גם אם שמה/ו מוזכר כאן. ` +
        `אל תחתמי "צוות DALOR", אל תניחי שזה קשור למספרה אלא אם נאמר במפורש. ` +
        `נסחי ISO-8601 מדויק לזמן שהתבקש.]\n\n${body}`,
    });
    return result.reply || "טופל 👍";
  } catch (e) {
    console.error("owner command orchestrate failed", e);
    return "משהו השתבש אצלי — נסה שוב, או מהאפליקציה.";
  }
}
