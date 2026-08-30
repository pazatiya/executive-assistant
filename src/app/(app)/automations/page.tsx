import { desc, eq } from "drizzle-orm";
import { PageHeader, PageBody } from "@/components/layout/page-header";
import { AutomationsPanel } from "@/components/automations/automations-panel";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { automationRules, senderRules } from "@/lib/db/schema";
import { RULE_TEMPLATES } from "@/lib/automation/engine";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const user = await getCurrentUser();
  const [rules, senders] = await Promise.all([
    db.select().from(automationRules).where(eq(automationRules.userId, user.id)).orderBy(desc(automationRules.createdAt)),
    db.select().from(senderRules).where(eq(senderRules.userId, user.id)).orderBy(desc(senderRules.createdAt)),
  ]);

  return (
    <>
      <PageHeader
        title="אוטומציות"
        description="חוקים שרצים על אירועים (מייל נכנס, הודעה, תזכורת). כל פעולה עדיין עוברת את מנוע האישורים — RED תמיד ידני."
      />
      <PageBody>
        <AutomationsPanel
          rules={rules}
          senders={senders}
          templates={RULE_TEMPLATES.map((t) => ({ ...t }))}
        />
      </PageBody>
    </>
  );
}
