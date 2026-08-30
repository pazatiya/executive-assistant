import { PageHeader, PageBody } from "@/components/layout/page-header";
import { ApprovalCenter } from "@/components/approvals/approval-center";
import { loadAppContext } from "@/lib/app-context";
import { listApprovals } from "@/lib/services/approvals";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const { user } = await loadAppContext();
  const approvals = await listApprovals(user.id, { limit: 200 });
  return (
    <>
      <PageHeader
        title="מרכז אישורים"
        description="כל פעולה שאינה GREEN עוברת דרך כאן. אישור מבצע את הפעולה מיד; RED תמיד דורש אישור מפורש."
      />
      <PageBody>
        <ApprovalCenter initial={approvals} />
      </PageBody>
    </>
  );
}
