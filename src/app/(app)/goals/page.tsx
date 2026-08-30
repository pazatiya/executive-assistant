import { PageHeader, PageBody } from "@/components/layout/page-header";
import { GoalsPanel } from "@/components/goals/goals-panel";
import { loadAppContext } from "@/lib/app-context";
import { listGoals } from "@/lib/services/goals";
import { listTasks } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const { user, activeWorkspace } = await loadAppContext();
  const [goals, tasks] = await Promise.all([
    listGoals(user.id, { workspaceId: activeWorkspace.id }),
    listTasks(user.id, { workspaceId: activeWorkspace.id }),
  ]);
  const tasksByGoal: Record<string, { id: string; title: string; status: string }[]> = {};
  for (const t of tasks) if (t.goalId) (tasksByGoal[t.goalId] ??= []).push({ id: t.id, title: t.title, status: t.status });

  return (
    <>
      <PageHeader
        title="מטרות"
        description="מטרות ארוכות טווח עם מדד, יעד והתקדמות. לכל מטרה משימות ורשימת next actions שהמזכירה מציעה."
      />
      <PageBody>
        <GoalsPanel initial={goals} tasksByGoal={tasksByGoal} />
      </PageBody>
    </>
  );
}
