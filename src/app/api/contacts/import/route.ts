import { apiContext, bad, ok } from "@/lib/api";
import { parseVCards } from "@/lib/contacts/vcard";
import { importContacts } from "@/lib/services/contacts";

export const dynamic = "force-dynamic";

/**
 * Upload a .vcf (vCard) export from a phone / Google Contacts. Everything lands
 * in the caller's active workspace — for a personal workspace that keeps the
 * address book private to that owner (scope.ts), which is the point.
 */
export async function POST(req: Request) {
  const { user, workspaceId } = await apiContext(req);

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
