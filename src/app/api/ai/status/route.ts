import { ModelRouter } from "@/lib/ai/model-router";
import { ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  return ok(ModelRouter.status());
}
