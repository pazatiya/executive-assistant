import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { integrations, users, workspaces } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { id } from "@/lib/ids";
import { nowIso } from "@/lib/utils";
import { getCurrentUser } from "@/lib/auth";
import { getConnectedNumber, getSession, registerWebhook, wahaConfigured } from "@/lib/integrations/waha";
import { logActivity } from "@/lib/services/activity";

export const dynamic = "force-dynamic";

/**
 * Link the customer WhatsApp line (יאיר's number) to the assistant:
 * verify WAHA session is WORKING, point it at our webhook, and flip the
 * `whatsapp` integration row (owned by WHATSAPP_OWNER_EMAIL) to connected.
 */
async function link() {
  if (!wahaConfigured()) return { ok: false, status: 400, detail: "WAHA_API_KEY חסר ב-.env.local" };

  const session = await getSession();
  if (!session) return { ok: false, status: 502, detail: "אין תגובה מ-WAHA — הריצו wa.py ensure-up" };
  if (session.status !== "WORKING")
    return { ok: false, status: 409, detail: `WhatsApp לא מקושר (${session.status}). הריצו wa.py connect` };

  const hook = await registerWebhook();
  if (!hook.ok) return { ok: false, status: 502, detail: hook.detail };

  const number = await getConnectedNumber();

  const owner = await db.query.users.findFirst({ where: eq(users.email, env.whatsappOwnerEmail) });
  if (!owner) return { ok: false, status: 500, detail: `משתמש ${env.whatsappOwnerEmail} לא קיים — הריצו db:seed` };
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, env.whatsappWorkspaceSlug) });

  const existing = await db.query.integrations.findFirst({
    where: and(
      eq(integrations.provider, "whatsapp"),
      eq(integrations.userId, owner.id),
      isNull(integrations.workspaceId),
    ),
  });
  const metadata = { authKind: "waha", session: env.wahaSession, targetWorkspaceId: ws?.id ?? null };

  if (existing) {
    await db
      .update(integrations)
      .set({
        userId: owner.id,
        status: "connected",
        accountLabel: number ?? "WhatsApp",
        lastSyncedAt: nowIso(),
        lastError: null,
        metadata,
        updatedAt: nowIso(),
      })
      .where(eq(integrations.id, existing.id));
  } else {
    await db.insert(integrations).values({
      id: id("int"),
      userId: owner.id,
      workspaceId: null,
      provider: "whatsapp",
      displayName: "WhatsApp",
      status: "connected",
      capabilities: ["read_messages", "send_message"],
      scopes: [],
      accountLabel: number ?? "WhatsApp",
      lastSyncedAt: nowIso(),
      metadata,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  await logActivity({
    userId: owner.id,
    workspaceId: ws?.id ?? null,
    agent: "social",
    action: `WhatsApp חובר (${number ?? "?"}) — ${hook.detail}`,
    tool: "whatsapp",
    riskLevel: "yellow",
    approvalStatus: "approved",
    result: "success",
    autoExecuted: false,
  });

  return { ok: true, status: 200, detail: `WhatsApp מחובר: ${number ?? "?"}`, number };
}

export async function GET() {
  await getCurrentUser();
  const r = await link();
  // redirect back to the integrations screen with a flash
  const url = new URL("/integrations", env.appUrl);
  url.searchParams.set(r.ok ? "connected" : "error", r.ok ? "whatsapp" : r.detail);
  return Response.redirect(url, 303);
}

export async function POST() {
  await getCurrentUser();
  const r = await link();
  return Response.json({ ok: r.ok, detail: r.detail, number: r.number ?? null }, { status: r.status });
}
