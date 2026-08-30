import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { nowIso } from "@/lib/utils";

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

export async function listContacts(userId: string, opts: { workspaceId?: string } = {}) {
  const conds = [eq(contacts.userId, userId)];
  if (opts.workspaceId) conds.push(eq(contacts.workspaceId, opts.workspaceId));
  return db.select().from(contacts).where(and(...conds)).orderBy(desc(contacts.importance), desc(contacts.updatedAt));
}

export async function updateContact(userId: string, contactId: string, patch: Partial<Contact>) {
  const c = await db.query.contacts.findFirst({
    where: and(eq(contacts.id, contactId), eq(contacts.userId, userId)),
  });
  if (!c) return null;
  await db.update(contacts).set({ ...patch, updatedAt: nowIso() }).where(eq(contacts.id, contactId));
  return db.query.contacts.findFirst({ where: eq(contacts.id, contactId) });
}
