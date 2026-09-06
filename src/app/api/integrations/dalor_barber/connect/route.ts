import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { integrations } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { id } from "@/lib/ids";
import { nowIso } from "@/lib/utils";
import { getCurrentUser } from "@/lib/auth";
import { DalorBarberConnector } from "@/lib/integrations/dalor-barber";
import { logActivity } from "@/lib/services/activity";

export const dynamic = "force-dynamic";

async function link(userId: string) {
  const test = await new DalorBarberConnector().testConnection();
  const existing = await db.query.integrations.findFirst({
    where: eq(integrations.provider, "dalor_barber"),
  });
  const status = test.ok ? "connected" : "error";
  const patch = {
    userId,
    status: status as "connected" | "error",
    accountLabel: env.dalorBarberUrl.replace(/^https?:\/\//, ""),
    lastError: test.ok ? null : test.detail,
    lastSyncedAt: test.ok ? nowIso() : null,
    updatedAt: nowIso(),
  };
  if (existing) {
    await db.update(integrations).set(patch).where(eq(integrations.id, existing.id));
  } else {
    await db.insert(integrations).values({
      id: id("int"),
      workspaceId: null,
      provider: "dalor_barber",
      displayName: "DALOR — תורים",
      capabilities: ["check_availability", "list_appointments", "book_appointment"],
      scopes: [],
      metadata: { authKind: "api_key" },
      createdAt: nowIso(),
      ...patch,
    });
  }
  await logActivity({
    userId,
    agent: "task",
    action: `אפליקציית התורים ${test.ok ? "חוברה" : "נכשלה בחיבור"} — ${test.detail}`,
    tool: "dalor_barber",
    result: test.ok ? "success" : "failure",
  });
  return { ok: test.ok, detail: test.detail };
}

export async function GET() {
  const user = await getCurrentUser();
  const r = await link(user.id);
  const url = new URL("/integrations", env.appUrl);
  url.searchParams.set(r.ok ? "connected" : "error", r.ok ? "dalor_barber" : r.detail);
  return Response.redirect(url, 303);
}

export async function POST() {
  const user = await getCurrentUser();
  return Response.json(await link(user.id));
}
