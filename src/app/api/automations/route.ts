import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { automationRules } from "@/lib/db/schema";
import { apiContext, bad, ok, readJson } from "@/lib/api";
import { RULE_TEMPLATES } from "@/lib/automation/engine";
import { id } from "@/lib/ids";
import { nowIso } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await apiContext();
  const rows = await db
    .select()
    .from(automationRules)
    .where(eq(automationRules.userId, user.id))
    .orderBy(desc(automationRules.createdAt));
  return ok({ rules: rows, templates: RULE_TEMPLATES });
}

export async function POST(req: Request) {
  const { user, workspaceId } = await apiContext(req);
  const body = await readJson<{
    name: string;
    trigger: string;
    condition?: { field: string; op: string; value?: string };
    actionType: string;
    actionPayload?: Record<string, unknown>;
    forceApproval?: boolean;
    global?: boolean;
  }>(req);
  if (!body.name?.trim() || !body.trigger || !body.actionType) return bad("חסרים שדות חובה");

  const row = {
    id: id("auto"),
    userId: user.id,
    workspaceId: body.global ? null : workspaceId,
    name: body.name.trim(),
    trigger: body.trigger,
    triggerConfig: {},
    condition: (body.condition ?? {}) as Record<string, unknown>,
    actionType: body.actionType,
    actionPayload: body.actionPayload ?? {},
    forceApproval: body.forceApproval ?? false,
    enabled: true,
    lastRunAt: null,
    runCount: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.insert(automationRules).values(row);
  return ok(row, 201);
}
