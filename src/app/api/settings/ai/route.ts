import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { apiContext, bad, ok, readJson } from "@/lib/api";
import { ModelRouter } from "@/lib/ai/model-router";
import { nowIso } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await apiContext();
  const row = await db.query.users.findFirst({ where: eq(users.id, user.id) });
  const ai = (row?.preferences as { ai?: { provider?: string; model?: string } } | undefined)?.ai ?? {};
  return ok({ status: ModelRouter.status(), current: ai });
}

export async function POST(req: Request) {
  const { user } = await apiContext();
  const body = await readJson<{ provider?: string | null; model?: string | null }>(req);
  const status = ModelRouter.status();

  if (body.provider && body.provider !== "auto") {
    const p = status.providers.find((x) => x.name === body.provider);
    if (!p) return bad("ספק לא ידוע");
    if (!p.available) return bad(`${body.provider} לא מוגדר — הוסיפי מפתח ב-.env.local`);
    if (body.model && !p.models.some((m) => m.id === body.model)) return bad("מודל לא ברשימה עבור הספק");
  }

  const row = await db.query.users.findFirst({ where: eq(users.id, user.id) });
  const prefs = (row?.preferences as Record<string, unknown>) ?? {};
  prefs.ai =
    !body.provider || body.provider === "auto"
      ? {}
      : { provider: body.provider, model: body.model ?? undefined };
  await db.update(users).set({ preferences: prefs, updatedAt: nowIso() }).where(eq(users.id, user.id));

  return ok({ current: prefs.ai });
}
