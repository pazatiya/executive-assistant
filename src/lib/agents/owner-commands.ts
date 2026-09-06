/**
 * Owner command parser for the WhatsApp command channel.
 * Recognised (Hebrew or English), case-insensitive:
 *   אשר A7            / approve A7
 *   דחה A7            / reject A7
 *   ערוך A7: <טקסט>   / edit A7: <text>
 *   סטטוס             / status   → list pending approvals
 */
import { getApprovalByShortCode, decideApproval } from "@/lib/services/approvals";

const CODE = "([A-Za-z][0-9])";
const RE_APPROVE = new RegExp(`^\\s*(?:אשר|אישור|approve|ok|כן)\\s+${CODE}\\s*$`, "i");
const RE_REJECT = new RegExp(`^\\s*(?:דחה|דחייה|reject|לא|בטל)\\s+${CODE}\\s*$`, "i");
const RE_EDIT = new RegExp(`^\\s*(?:ערוך|עריכה|edit)\\s+${CODE}\\s*[:：]\\s*([\\s\\S]+)$`, "i");
const RE_STATUS = /^\s*(?:סטטוס|status|אישורים|pending)\s*$/i;

export interface OwnerCommandResult {
  isCommand: boolean;
  reply?: string;
}

export async function handleOwnerCommand(
  text: string,
  who: string,
): Promise<OwnerCommandResult> {
  const t = text.trim();

  if (RE_STATUS.test(t)) {
    // any owner shares the same pending queue; use the first approval's owner scope
    const anyPending = await listPendingAcrossOwners();
    if (!anyPending.length) return { isCommand: true, reply: "אין אישורים ממתינים 🎉" };
    const lines = anyPending
      .slice(0, 10)
      .map((a) => `${a.shortCode ?? "—"} · ${a.riskLevel === "red" ? "🔴" : "🟡"} ${a.title}`);
    return { isCommand: true, reply: `אישורים ממתינים:\n${lines.join("\n")}\n\nאשר <קוד> / דחה <קוד>` };
  }

  const mApprove = t.match(RE_APPROVE);
  const mReject = t.match(RE_REJECT);
  const mEdit = t.match(RE_EDIT);
  if (!mApprove && !mReject && !mEdit) return { isCommand: false };

  const code = (mApprove?.[1] ?? mReject?.[1] ?? mEdit?.[1] ?? "").toUpperCase();
  const apr = await getApprovalByShortCode(code);
  if (!apr) {
    return {
      isCommand: true,
      reply: `לא מצאתי אישור פתוח עם הקוד ${code}. שלח/י "סטטוס" לרשימה.`,
    };
  }

  const decision = mEdit ? "edit_approve" : mApprove ? "approve" : "reject";
  const editedText = mEdit?.[2]?.trim();
  const res = await decideApproval(apr.userId, apr.id, decision, {
    decidedBy: who,
    editedPayload: editedText
      ? { text: editedText, body: editedText, preview: editedText }
      : undefined,
  });

  if (!res.ok) {
    if (res.error?.startsWith("already")) {
      return { isCommand: true, reply: `אישור ${code} כבר טופל (${describeStatus(res.error)}).` };
    }
    return { isCommand: true, reply: `לא הצלחתי: ${res.error}` };
  }

  if (decision === "reject") return { isCommand: true, reply: `אישור ${code} נדחה. ✋` };
  const outcome = res.status === "executed" ? "בוצע ונשלח ✅" : res.status === "failed" ? "אושר אך הביצוע נכשל ⚠️" : "אושר";
  return { isCommand: true, reply: `אישור ${code}: ${outcome}` };
}

function describeStatus(err: string): string {
  const s = err.replace(/^already\s+/, "");
  return (
    { approved: "אושר", edited_approved: "אושר עם עריכה", rejected: "נדחה", executed: "בוצע", failed: "נכשל", expired: "פג תוקף" }[
      s
    ] ?? s
  );
}

async function listPendingAcrossOwners() {
  // decideApproval scopes by workspace membership, but for a read-only status
  // list we want the whole pending queue. listApprovals needs a userId; use a
  // direct query instead.
  const { db } = await import("@/lib/db");
  const { approvals } = await import("@/lib/db/schema");
  const { eq, desc } = await import("drizzle-orm");
  return db
    .select()
    .from(approvals)
    .where(eq(approvals.status, "pending"))
    .orderBy(desc(approvals.createdAt))
    .limit(20);
}
