import { and, eq, inArray } from "drizzle-orm";
import { PageHeader, PageBody } from "@/components/layout/page-header";
import { WorkspacesPanel } from "@/components/workspaces/workspaces-panel";
import { getCurrentUser } from "@/lib/auth";
import { listWorkspaces } from "@/lib/services/workspaces";
import { db } from "@/lib/db";
import { contacts, goals, memories, tasks } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function WorkspacesPage() {
  const user = await getCurrentUser();
  const workspaces = await listWorkspaces(user.id);

  const stats: Record<string, { tasks: number; goals: number; contacts: number; memories: number }> = {};
  for (const w of workspaces) {
    const [t, g, c, m] = await Promise.all([
      db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.workspaceId, w.id), inArray(tasks.status, ["inbox", "planned", "in_progress", "waiting", "waiting_approval"]))),
      db.select({ id: goals.id }).from(goals).where(eq(goals.workspaceId, w.id)),
      db.select({ id: contacts.id }).from(contacts).where(eq(contacts.workspaceId, w.id)),
      db.select({ id: memories.id }).from(memories).where(eq(memories.workspaceId, w.id)),
    ]);
    stats[w.id] = { tasks: t.length, goals: g.length, contacts: c.length, memories: m.length };
  }

  return (
    <>
      <PageHeader
        title="Workspaces"
        description="הפרדה מלאה בין הקשרים: אנשי קשר, מסמכים, אינטגרציות, משימות, מטרות, זיכרון, מותג וסגנון כתיבה לכל workspace."
      />
      <PageBody>
        <WorkspacesPanel
          initial={workspaces.map((w) => ({
            id: w.id,
            name: w.name,
            type: w.type,
            description: w.description,
            color: w.color,
            brandVoice: w.brandVoice,
          }))}
          stats={stats}
        />
      </PageBody>
    </>
  );
}
