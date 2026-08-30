import { apiContext, ok } from "@/lib/api";
import { listApprovals, type Approval } from "@/lib/services/approvals";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { user } = await apiContext(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status") as Approval["status"] | null;
  return ok(await listApprovals(user.id, { statuses: status ? [status] : undefined, limit: 200 }));
}
