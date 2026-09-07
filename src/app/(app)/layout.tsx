import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { LiveRefresh } from "@/components/layout/live-refresh";
import { loadAppContext } from "@/lib/app-context";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, workspaces, activeWorkspace, counts } = await loadAppContext();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar counts={counts} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar
          workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, type: w.type, color: w.color }))}
          activeId={activeWorkspace.id}
          userName={user.fullName || user.email}
          notifications={counts.notifications}
          counts={counts}
        />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
      <LiveRefresh />
    </div>
  );
}
