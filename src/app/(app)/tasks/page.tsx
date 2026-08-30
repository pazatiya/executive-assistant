import { PageHeader, PageBody } from "@/components/layout/page-header";
import { TaskBoard } from "@/components/tasks/task-board";
import { loadAppContext } from "@/lib/app-context";
import { listTasks } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const { user, activeWorkspace } = await loadAppContext();
  const tasks = await listTasks(user.id, { workspaceId: activeWorkspace.id });
  return (
    <>
      <PageHeader
        title="משימות"
        description={`${activeWorkspace.name} · המזכירה יוצרת משימות עם תוכנית שלבים, ועוקבת עד שהתוצאה מושגת`}
      />
      <PageBody>
        <TaskBoard initial={tasks} />
      </PageBody>
    </>
  );
}
