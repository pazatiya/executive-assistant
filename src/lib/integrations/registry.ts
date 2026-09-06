import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { integrations } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { nowIso } from "@/lib/utils";
import { CatalogConnector, PROVIDER_CATALOG, specFor } from "./catalog";
import { makeGoogleConnector } from "./google";
import { makeWahaConnector } from "./waha";
import { makeDalorBarberConnector } from "./dalor-barber";
import type { Connector, ConnectorStatus } from "./connector";

/**
 * Returns a live Connector for (user, provider, workspace), reflecting the row
 * in `integrations`. Real connectors register via `makeRealConnector`; everything
 * else falls back to CatalogConnector (reports not-connected + setup hint).
 */
function makeRealConnector(provider: string, integrationId: string | null): Connector | null {
  return (
    makeGoogleConnector(provider, integrationId) ??
    makeWahaConnector(provider, integrationId) ??
    makeDalorBarberConnector(provider)
  );
}

export async function getConnector(
  userId: string,
  provider: string,
  workspaceId: string | null,
): Promise<(Connector & { status: ConnectorStatus; integrationId: string | null }) | null> {
  const spec = specFor(provider);
  if (!spec) return null;

  const row = await db.query.integrations.findFirst({
    where: and(
      eq(integrations.userId, userId),
      eq(integrations.provider, provider),
      workspaceId ? eq(integrations.workspaceId, workspaceId) : isNull(integrations.workspaceId),
    ),
  });

  const connector = makeRealConnector(provider, row?.id ?? null) ?? new CatalogConnector(spec);
  connector.status = (row?.status as ConnectorStatus) ?? "not_connected";
  return Object.assign(connector, { integrationId: row?.id ?? null });
}

/** Ensure an integrations row exists for every catalog provider (account-level). */
export async function ensureIntegrationRows(userId: string) {
  for (const spec of PROVIDER_CATALOG) {
    const existing = await db.query.integrations.findFirst({
      where: and(
        eq(integrations.userId, userId),
        eq(integrations.provider, spec.provider),
        isNull(integrations.workspaceId),
      ),
    });
    if (existing) continue;
    await db.insert(integrations).values({
      id: id("int"),
      userId,
      workspaceId: null,
      provider: spec.provider,
      displayName: spec.displayName,
      status: "not_connected",
      capabilities: spec.capabilities.map((c) => c.key),
      scopes: [],
      metadata: { phase: spec.phase, authKind: spec.authKind, setupHint: spec.setupHint },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }
}

export async function listIntegrations(userId: string) {
  const rows = await db.query.integrations.findMany({ where: eq(integrations.userId, userId) });
  return PROVIDER_CATALOG.map((spec) => {
    const row = rows.find((r) => r.provider === spec.provider && !r.workspaceId);
    return {
      provider: spec.provider,
      displayName: spec.displayName,
      category: spec.category,
      phase: spec.phase,
      authKind: spec.authKind,
      setupHint: spec.setupHint,
      capabilities: spec.capabilities,
      status: (row?.status as ConnectorStatus) ?? "not_connected",
      accountLabel: row?.accountLabel ?? null,
      lastSyncedAt: row?.lastSyncedAt ?? null,
      lastError: row?.lastError ?? null,
      integrationId: row?.id ?? null,
    };
  });
}
