import { apiContext, bad, ok } from "@/lib/api";
import { replyToMessageWithMedia } from "@/lib/services/messages";

export const dynamic = "force-dynamic";

/** Owner attaches an image/video in the app's reply box and sends it to the customer. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await apiContext(req);
  const { id } = await params;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || !(file instanceof File)) return bad("חסר קובץ");
  const caption = (form?.get("caption") as string | null) ?? undefined;

  const bytes = await file.arrayBuffer();
  const r = await replyToMessageWithMedia(user.id, id, bytes, file.type || "application/octet-stream", caption);
  if (!r.ok) {
    return bad(r.error === "not_found" ? "לא נמצא" : r.error ?? "שליחה נכשלה", r.error === "not_found" ? 404 : 400);
  }
  return ok({ status: "replied" });
}
