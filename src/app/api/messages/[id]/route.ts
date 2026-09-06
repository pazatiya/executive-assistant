import { apiContext, bad, ok, readJson } from "@/lib/api";
import { ignoreMessage, replyToMessage } from "@/lib/services/messages";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await apiContext(req);
  const { id } = await params;
  const body = await readJson<{ action: "reply" | "ignore"; text?: string }>(req);

  if (body.action === "ignore") {
    const r = await ignoreMessage(user.id, id);
    return r ? ok({ status: "ignored" }) : bad("לא נמצא", 404);
  }

  if (body.action === "reply") {
    const r = await replyToMessage(user.id, id, body.text);
    if (!r.ok) return bad(r.error ?? "שליחה נכשלה", r.error === "not_found" ? 404 : 400);
    return ok({ status: r.sent ? "replied" : "drafted", sent: r.sent });
  }

  return bad("action לא ידוע");
}
