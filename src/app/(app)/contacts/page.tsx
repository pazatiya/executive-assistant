import { PageHeader, PageBody } from "@/components/layout/page-header";
import { ContactsPanel } from "@/components/contacts/contacts-panel";
import { loadAppContext } from "@/lib/app-context";
import { listContacts } from "@/lib/services/contacts";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const { user, activeWorkspace } = await loadAppContext();
  const contacts = await listContacts(user.id, { workspaceId: activeWorkspace.id });
  return (
    <>
      <PageHeader title="אנשי קשר" description={`ספר קשרים חכם ל-${activeWorkspace.name}: תפקיד, חשיבות, סגנון תקשורת ונושאים פתוחים`} />
      <PageBody>
        <ContactsPanel initial={contacts} />
      </PageBody>
    </>
  );
}
