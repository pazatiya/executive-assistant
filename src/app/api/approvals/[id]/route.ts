import { apiContext, bad, ok, readJson } from "@/lib/api";
import { alwaysAllowFromApproval, decideApproval, type Decision } from "@/lib/services/approvals";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await apiContext();
  const { id } = await params;
  const body = await readJson<{ decision: Decision | "always_allow"; editedPayload?: Record<string, unknown> }>(req);

  if (body.decision === "always_allow") {
    const r = await alwaysAllowFromApproval(user.id, id);
    if (!r.ok) return bad(r.error ?? "לא ניתן", 400);
    // then approve+execute
    const decided = await decideApproval(user.id, id, "approve", { decidedBy: user.email });
    return ok(decided);
  }

  if (!["approve", "reject", "edit_approve"].includes(body.decision)) return bad("החלטה לא חוקית");
  const result = await decideApproval(user.id, id, body.decision, {
    editedPayload: body.editedPayload,
    decidedBy: user.email,
  });
  if (!result.ok) return bad(result.error ?? "שגיאה", 400);
  return ok(result);
}
