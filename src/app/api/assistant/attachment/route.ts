import { apiContext, bad, ok } from "@/lib/api";
import { ingestDocument } from "@/lib/services/documents";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Attachment for a "handle this" chat turn. Accepts a file (screenshot / pdf /
 * doc / sheet) or pasted text (e.g. a forwarded email). Everything becomes a
 * document so the orchestrator can read it via its id.
 */
export async function POST(req: Request) {
  const { user, workspaceId } = await apiContext(req);
  const ct = req.headers.get("content-type") ?? "";

  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return bad("לא נשלח קובץ");
    if (file.size > 25 * 1024 * 1024) return bad("קובץ גדול מדי (מקסימום 25MB)");
    const doc = await ingestDocument({
      userId: user.id,
      workspaceId,
      title: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      buffer: await file.arrayBuffer(),
    });
    return ok({ id: doc.id, title: doc.title, kind: doc.kind, summary: doc.summary, status: doc.status }, 201);
  }

  const body = (await req.json().catch(() => ({}))) as { text?: string; title?: string };
  if (!body.text?.trim()) return bad("חסר תוכן");
  const doc = await ingestDocument({
    userId: user.id,
    workspaceId,
    title: body.title?.trim() || "טקסט שהודבק",
    mimeType: "text/plain",
    sizeBytes: body.text.length,
    text: body.text,
  });
  return ok({ id: doc.id, title: doc.title, kind: doc.kind, summary: doc.summary, status: doc.status }, 201);
}
