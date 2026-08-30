import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { automationRules } from "@/lib/db/schema";
import { apiContext, bad, ok, readJson } from "@/lib/api";
import { nowIso } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await apiContext();
  const { id } = await params;
  const body = await readJson<{ enabled?: boolean; forceApproval?: boolean; name?: string }>(req);
  const rule = await db.query.automationRules.findFirst({
    where: and(eq(automationRules.id, id), eq(automationRules.userId, user.id)),
  });
  if (!rule) return bad("לא נמצא", 404);
  await db.update(automationRules).set({ ...body, updatedAt: nowIso() }).where(eq(automationRules.id, id));
  return ok({ ...rule, ...body });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await apiContext();
  const { id } = await params;
  await db.delete(automationRules).where(and(eq(automationRules.id, id), eq(automationRules.userId, user.id)));
  return ok({ deleted: id });
}
