import Link from "next/link";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { AiStatusPill } from "./ai-status-pill";
import { NotificationsBell } from "./notifications-bell";
import { MobileNav } from "./mobile-nav";
import { PushRegister } from "@/components/push-register";

interface Props {
  workspaces: { id: string; name: string; type: string; color: string }[];
  activeId: string;
  userName: string;
  notifications: number;
  counts: Record<string, number>;
}

export function Topbar({ workspaces, activeId, userName, notifications, counts }: Props) {
  return (
    <header className="relative z-30 flex h-[68px] shrink-0 items-center gap-2 border-b bg-card/95 px-3 shadow-[0_1px_0_rgba(15,23,42,0.02)] sm:gap-3 sm:px-6">
      <MobileNav counts={counts} />
      <WorkspaceSwitcher workspaces={workspaces} activeId={activeId} />
      <AiStatusPill />
      <div className="flex-1" />
      <PushRegister />
      <NotificationsBell initialUnread={notifications} />
      <Link
        href="/login"
        title="החלפת משתמש"
        className="flex h-10 items-center gap-2 rounded-xl border bg-card px-1.5 shadow-sm transition-all hover:border-primary/30 hover:shadow-md sm:px-2.5"
      >
        <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-[#7b69eb] text-xs font-bold text-white">
          {userName.slice(0, 1)}
        </div>
        <span className="hidden max-w-24 truncate text-sm font-medium sm:block">{userName}</span>
      </Link>
    </header>
  );
}
