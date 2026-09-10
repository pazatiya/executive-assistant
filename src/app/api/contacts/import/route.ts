import { and, eq } from "drizzle-orm";
import { apiContext, bad, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { parseVCards } from "@/lib/contacts/vcard";
import { importContacts } from "@/lib/services/contacts";

export const dynamic = "force-dynamic";

/**
 * Upload a .vcf (vCard) export from a phone / Google Contacts. A phone address
 * book is personal, so it always lands in the caller's *personal* workspace
 * (not whatever workspace is on screen) — scope.ts then keeps it private to
 * them, which is the whole point.
 */
export async function POST(req: Request) {
  const { user, workspaceId: activeWs } = await apiContext(req);
  const personal = await db.query.workspaces.findFirst({
    where: and(eq(workspaces.ownerId, user.id), eq(workspaces.type, "personal")),
  });
  const workspaceId = personal?.id ?? activeWs;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return bad("צריך לצרף קובץ vCard (.vcf)");
  if (file.size > 8 * 1024 * 1024) return bad("הקובץ גדול מדי (מקסימום 8MB)");

  const text = await file.text();
  const people = parseVCards(text);
  if (!people.length) return bad("לא נמצאו אנשי קשר בקובץ — ודאי שזה קובץ vCard תקין");

  const { added, skipped } = await importContacts(user.id, workspaceId, people);
  return ok({ found: people.length, added, skipped }, 201);
}
