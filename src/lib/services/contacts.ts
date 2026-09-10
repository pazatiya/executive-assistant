import { and, desc, eq, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { nowIso } from "@/lib/utils";
import { canAccessRow, listScope } from "@/lib/auth/scope";

export type Contact = typeof contacts.$inferSelect;

export interface CreateContactInput {
  userId: string;
  workspaceId: string;
  name: string;
  company?: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  relationshipType?: Contact["relationshipType"];
  importance?: Contact["importance"];
  communicationStyle?: string;
  notes?: string;
  tags?: string[];
}

export async function createContact(input: CreateContactInput): Promise<Contact> {
  const row: Contact = {
    id: id("con"),
    userId: input.userId,
    workspaceId: input.workspaceId,
    name: input.name,
    company: input.company ?? null,
    role: input.role ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    socialHandles: {},
    relationshipType: input.relationshipType ?? "other",
    importance: input.importance ?? "normal",
    communicationStyle: input.communicationStyle ?? "",
    notes: input.notes ?? "",
    openThreads: [],
    tags: input.tags ?? [],
    lastInteractionAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.insert(contacts).values(row);
  return row;
}

/**
 * Bulk import from a parsed contacts file (vCard). Idempotent-ish: an existing
 * contact in the same workspace with a matching phone (or, lacking a phone, a
 * matching name) is skipped rather than duplicated.
 */
export async function importContacts(
  userId: string,
  workspaceId: string,
  people: { name: string; phone?: string; email?: string | null; company?: string | null; note?: string | null }[],
): Promise<{ added: number; skipped: number }> {
  const existing = await db
    .select({ name: contacts.name, phone: contacts.phone })
    .from(contacts)
    .where(eq(contacts.workspaceId, workspaceId));
  const seenPhones = new Set(existing.map((e) => (e.phone ?? "").replace(/\D/g, "")).filter(Boolean));
  const seenNames = new Set(existing.map((e) => e.name.trim().toLowerCase()).filter(Boolean));

  let added = 0;
  let skipped = 0;
  const rows: Contact[] = [];
  for (const p of people) {
    const name = p.name?.trim();
    if (!name) { skipped++; continue; }
    const digits = (p.phone ?? "").replace(/\D/g, "");
    if (digits && seenPhones.has(digits)) { skipped++; continue; }
    if (!digits && seenNames.has(name.toLowerCase())) { skipped++; continue; }
    if (digits) seenPhones.add(digits);
    seenNames.add(name.toLowerCase());
    rows.push({
      id: id("con"),
      userId,
      workspaceId,
      name,
      company: p.company ?? null,
      role: null,
      email: p.email ?? null,
      phone: p.phone ?? null,
      socialHandles: {},
      relationshipType: "other",
      importance: "normal",
      communicationStyle: "",
      notes: p.note ?? "",
      openThreads: [],
      tags: ["יובא"],
      lastInteractionAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    added++;
  }
  // libSQL caps bound params per statement — insert in chunks
  for (let i = 0; i < rows.length; i += 100) {
    await db.insert(contacts).values(rows.slice(i, i + 100));
  }
  return { added, skipped };
}

export async function listContacts(userId: string, opts: { workspaceId?: string } = {}) {
  const conds: SQL[] = [
    await listScope({ userId: contacts.userId, workspaceId: contacts.workspaceId }, userId, opts.workspaceId),
  ];
  return db.select().from(contacts).where(and(...conds)).orderBy(desc(contacts.importance), desc(contacts.updatedAt));
}

export async function updateContact(userId: string, contactId: string, patch: Partial<Contact>) {
  const c = await db.query.contacts.findFirst({ where: eq(contacts.id, contactId) });
  if (!c || !(await canAccessRow(userId, c))) return null;
  await db.update(contacts).set({ ...patch, updatedAt: nowIso() }).where(eq(contacts.id, contactId));
  return db.query.contacts.findFirst({ where: eq(contacts.id, contactId) });
}
