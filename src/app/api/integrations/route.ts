import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { integrations } from "@/lib/db/schema";
import { apiContext, bad, ok, readJson } from "@/lib/api";
import { ensureIntegrationRows, listIntegrations } from "@/lib/integrations/registry";
import { nowIso } from "@/lib/utils";
import { logActivity } from "@/lib/services/activity";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await apiContext();
  await ensureIntegrationRows(user.id);
  return ok(await listIntegrations(user.id));
}

// Dev-only: mark an integration connected/disconnected for demo/testing.
// Real OAuth/API-key handshakes replace this per-provider in phase 3/4.
export async function POST(req: Request) {
  const { user } = await apiContext();
  const body = await readJson<{ provider: string; action: "connect" | "disconnect"; accountLabel?: string }>(req);
  if (!body.provider) return bad("חסר provider");

  const row = await db.query.integrations.findFirst({
    where: and(
      eq(integrations.userId, user.id),
      eq(integrations.provider, body.provider),
      isNull(integrations.workspaceId),
    ),
  });
  if (!row) return bad("integration לא נמצא", 404);

  const connected = body.action === "connect";
  await db
    .update(integrations)
    .set({
      status: connected ? "connected" : "not_connected",
      accountLabel: connected ? body.accountLabel ?? `${body.provider} (dev)` : null,
      lastSyncedAt: connected ? nowIso() : null,
      lastError: null,
      updatedAt: nowIso(),
    })
    .where(eq(integrations.id, row.id));

  await logActivity({
    userId: user.id,
    action: `${connected ? "חובר" : "נותק"} אינטגרציה: ${body.provider}`,
    tool: body.provider,
    riskLevel: "yellow",
    approvalStatus: "approved",
    approvedBy: user.email,
    result: "success",
    autoExecuted: false,
  });

  return ok({ provider: body.provider, status: connected ? "connected" : "not_connected" });
}
