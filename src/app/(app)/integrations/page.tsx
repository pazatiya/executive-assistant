import { PageHeader, PageBody } from "@/components/layout/page-header";
import { IntegrationsPanel } from "@/components/integrations/integrations-panel";
import { getCurrentUser } from "@/lib/auth";
import { ensureIntegrationRows, listIntegrations } from "@/lib/integrations/registry";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const user = await getCurrentUser();
  await ensureIntegrationRows(user.id);
  const integrations = await listIntegrations(user.id);
  return (
    <>
      <PageHeader
        title="אינטגרציות"
        description="Connector אחיד לכל שירות (connect / disconnect / testConnection / listCapabilities / executeAction / fetchData / webhookHandler). מה שלא מחובר מסומן Not Connected."
      />
      <PageBody>
        <IntegrationsPanel initial={integrations} />
      </PageBody>
    </>
  );
}
