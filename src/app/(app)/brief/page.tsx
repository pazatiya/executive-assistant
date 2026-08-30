import { PageHeader, PageBody } from "@/components/layout/page-header";
import { BriefView } from "@/components/brief/brief-view";
import { loadAppContext } from "@/lib/app-context";
import { buildEndOfDayBrief, buildMorningBrief } from "@/lib/services/brief";

export const dynamic = "force-dynamic";

export default async function BriefPage() {
  const { user } = await loadAppContext();
  const [morning, eod] = await Promise.all([buildMorningBrief(user.id), buildEndOfDayBrief(user.id)]);
  return (
    <>
      <PageHeader
        title="Daily Brief"
        description="סקירת בוקר וסיכום סוף יום. אפשר לשלוח לעצמך כהתראה, או לתזמן שירוץ אוטומטית כל בוקר."
      />
      <PageBody>
        <BriefView morning={morning} eod={eod} />
      </PageBody>
    </>
  );
}
