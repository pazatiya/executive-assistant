import { PageHeader, PageBody } from "@/components/layout/page-header";
import { MemoryPanel } from "@/components/memory/memory-panel";
import { loadAppContext } from "@/lib/app-context";
import { listMemories } from "@/lib/services/memory";

export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  const { user, activeWorkspace } = await loadAppContext();
  const memories = await listMemories(user.id, { workspaceId: activeWorkspace.id });
  return (
    <>
      <PageHeader
        title="זיכרון"
        description="4 שכבות: Permanent (כללים והעדפות) · Working (הקשר משימה) · Knowledge Base · Activity History. כללים כאן נאכפים במנוע האישורים."
      />
      <PageBody>
        <MemoryPanel initial={memories} workspaceName={activeWorkspace.name} />
      </PageBody>
    </>
  );
}
