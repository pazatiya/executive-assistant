import Link from "next/link";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { AiStatusPill } from "./ai-status-pill";
import { NotificationsBell } from "./notifications-bell";
import { PushRegister } from "@/components/push-register";

interface Props {
  workspaces: { id: string; name: string; type: string; color: string }[];
  activeId: string;
  userName: string;
  notifications: number;
}

export function Topbar({ workspaces, activeId, userName, notifications }: Props) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card/40 px-4">
      <WorkspaceSwitcher workspaces={workspaces} activeId={activeId} />
      <AiStatusPill />
      <div className="flex-1" />
      <PushRegister />
      <NotificationsBell initialUnread={notifications} />
      <Link
        href="/login"
        title="החלפת משתמש"
        className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors hover:border-primary/40"
      >
        <div className="flex size-6 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
          {userName.slice(0, 1)}
        </div>
        <span className="text-sm">{userName}</span>
      </Link>
    </header>
  );
}
