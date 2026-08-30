import { desc, eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { senderRules } from "@/lib/db/schema";
import { apiContext, bad, ok, readJson } from "@/lib/api";
import { id } from "@/lib/ids";
import { nowIso } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await apiContext();
  return ok(
    await db.select().from(senderRules).where(eq(senderRules.userId, user.id)).orderBy(desc(senderRules.createdAt)),
  );
}

export async function POST(req: Request) {
  const { user } = await apiContext();
  const b = await readJson<{
    sender: string;
    category?: string;
    priority?: string;
    autoArchive?: boolean;
    autoReplyAllowed?: boolean;
    approvalRequired?: boolean;
    notes?: string;
  }>(req);
  if (!b.sender?.trim()) return bad("חסר שולח");
  const row = {
    id: id("sr"),
    userId: user.id,
    workspaceId: null,
    sender: b.sender.trim(),
    category: (b.category as never) ?? "business",
    priority: (b.priority as never) ?? "normal",
    autoArchive: b.autoArchive ?? false,
    autoReplyAllowed: b.autoReplyAllowed ?? false,
    approvalRequired: b.approvalRequired ?? true,
    notes: b.notes ?? "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.insert(senderRules).values(row);
  return ok(row, 201);
}

export async function DELETE(req: Request) {
  const { user } = await apiContext();
  const ruleId = new URL(req.url).searchParams.get("id");
  if (!ruleId) return bad("חסר id");
  await db.delete(senderRules).where(and(eq(senderRules.id, ruleId), eq(senderRules.userId, user.id)));
  return ok({ deleted: ruleId });
}
