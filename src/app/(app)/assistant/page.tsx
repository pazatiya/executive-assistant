import { PageHeader } from "@/components/layout/page-header";
import { AssistantChat } from "@/components/assistant/chat";
import { loadAppContext } from "@/lib/app-context";
import { listConversations } from "@/lib/services/conversations";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  const { user, activeWorkspace } = await loadAppContext();
  const conversations = await listConversations(user.id);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="המזכירה"
        description={`סביבת העבודה הפעילה: ${activeWorkspace.name} · כתבו מה לעשות — ואבצע או אעביר לאישור בהתאם`}
      />
      <AssistantChat
        conversations={conversations.map((c) => ({ id: c.id, title: c.title, at: c.lastMessageAt }))}
        workspaceName={activeWorkspace.name}
      />
    </div>
  );
}
