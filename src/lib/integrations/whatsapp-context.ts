/**
 * Customer WhatsApp runs on יאיר's single line. Both connect and the inbound
 * webhook need to agree on who "owns" those messages and which workspace they
 * belong to. Resolution order:
 *   1. a connected `whatsapp` integration row (authoritative once linked)
 *   2. env WHATSAPP_OWNER_EMAIL + WHATSAPP_WORKSPACE_SLUG
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { integrations, users, workspaces } from "@/lib/db/schema";
import { env } from "@/lib/env";

export interface WhatsAppTarget {
  userId: string;
  workspaceId: string | null;
  integrationId: string | null;
}

export async function resolveWhatsAppTarget(): Promise<WhatsAppTarget | null> {
  const connected = await db.query.integrations.findFirst({
    where: and(eq(integrations.provider, "whatsapp"), eq(integrations.status, "connected")),
  });
  if (connected) {
    const meta = (connected.metadata ?? {}) as { targetWorkspaceId?: string };
    return {
      userId: connected.userId,
      workspaceId: meta.targetWorkspaceId ?? connected.workspaceId ?? null,
      integrationId: connected.id,
    };
  }

  const owner = await db.query.users.findFirst({ where: eq(users.email, env.whatsappOwnerEmail) });
  if (!owner) return null;
  const ws = await db.query.workspaces.findFirst({
    where: eq(workspaces.slug, env.whatsappWorkspaceSlug),
  });
  const row = await db.query.integrations.findFirst({
    where: and(
      eq(integrations.userId, owner.id),
      eq(integrations.provider, "whatsapp"),
      isNull(integrations.workspaceId),
    ),
  });
  return { userId: owner.id, workspaceId: ws?.id ?? null, integrationId: row?.id ?? null };
}
