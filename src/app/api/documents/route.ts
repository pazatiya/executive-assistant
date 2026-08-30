import { apiContext, bad, ok } from "@/lib/api";
import { ingestDocument, listDocuments } from "@/lib/services/documents";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const { user, workspaceId } = await apiContext(req);
  return ok(await listDocuments(user.id, { workspaceId }));
}

export async function POST(req: Request) {
  const { user, workspaceId } = await apiContext(req);
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
  return ok(doc, 201);
}
