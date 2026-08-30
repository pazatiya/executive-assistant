import { PageHeader, PageBody } from "@/components/layout/page-header";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { loadAppContext } from "@/lib/app-context";
import { listDocuments } from "@/lib/services/documents";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const { user, activeWorkspace } = await loadAppContext();
  const docs = await listDocuments(user.id, { workspaceId: activeWorkspace.id });
  return (
    <>
      <PageHeader
        title="מסמכים"
        description="העלאה, חילוץ תוכן, סיכום, זיהוי משימות/תאריכים/מידע פיננסי. טקסט ו-CSV נקראים עכשיו; PDF/DOCX/XLSX ייקראו בשלב הבא."
      />
      <PageBody>
        <DocumentsPanel initial={docs} />
      </PageBody>
    </>
  );
}
