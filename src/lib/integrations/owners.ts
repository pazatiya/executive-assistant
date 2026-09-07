/**
 * Owner ↔ WhatsApp-number mapping.
 *
 * `OWNER_WHATSAPP` = "email:number,email:number" — e.g.
 *   yair@dalor.co.il:972507983306,pazyairat@gmail.com:972547734708
 *
 * With a dedicated bot number, the owners CAN text the assistant again: a
 * message from an owner's number is a command, everything else is a customer.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { chatIdToNumber, normalizeChatId } from "./waha";

interface OwnerEntry {
  email: string;
  number: string; // normalized digits, e.g. 972507983306
}

function parseOwners(): OwnerEntry[] {
  return env.ownerWhatsapp
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.lastIndexOf(":");
      const email = pair.slice(0, i).trim();
      const number = chatIdToNumber(normalizeChatId(pair.slice(i + 1).trim()));
      return { email, number };
    })
    .filter((e) => e.email && e.number.length >= 8);
}

export function ownerNumbers(): string[] {
  return parseOwners().map((e) => e.number);
}

export function isOwnerNumber(raw: string): boolean {
  const n = chatIdToNumber(normalizeChatId(raw));
  return parseOwners().some((e) => e.number === n);
}

/** userId for the owner whose WhatsApp number this is, or null. */
export async function ownerUserIdForNumber(raw: string): Promise<string | null> {
  const n = chatIdToNumber(normalizeChatId(raw));
  const entry = parseOwners().find((e) => e.number === n);
  if (!entry) return null;
  const u = await db.query.users.findFirst({ where: eq(users.email, entry.email) });
  return u?.id ?? null;
}

/** WhatsApp number for a given owner userId, or null. */
export async function ownerNumberForUserId(userId: string): Promise<string | null> {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!u) return null;
  return parseOwners().find((e) => e.email === u.email)?.number ?? null;
}
