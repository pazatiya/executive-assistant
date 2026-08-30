import { apiContext, bad, ok, readJson } from "@/lib/api";
import { createContact, listContacts } from "@/lib/services/contacts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { user, workspaceId } = await apiContext(req);
  return ok(await listContacts(user.id, { workspaceId }));
}

export async function POST(req: Request) {
  const { user, workspaceId } = await apiContext(req);
  const body = await readJson<{
    name: string;
    company?: string;
    role?: string;
    email?: string;
    phone?: string;
    relationshipType?: string;
    importance?: string;
    notes?: string;
  }>(req);
  if (!body.name?.trim()) return bad("שם חסר");
  const c = await createContact({
    userId: user.id,
    workspaceId,
    name: body.name.trim(),
    company: body.company ?? null,
    role: body.role ?? null,
    email: body.email ?? null,
    phone: body.phone ?? null,
    relationshipType: body.relationshipType as never,
    importance: body.importance as never,
    notes: body.notes,
  });
  return ok(c, 201);
}
