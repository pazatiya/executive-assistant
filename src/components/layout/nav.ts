import {
  LayoutDashboard,
  Sparkles,
  ShieldCheck,
  CheckSquare,
  Calendar,
  MessagesSquare,
  FileText,
  Target,
  Users,
  Activity,
  Brain,
  Plug,
  Layers,
  Settings,
  Sun,
  Zap,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  countKey?: "approvals" | "tasks" | "notifications";
}

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/assistant", label: "המזכירה", icon: Sparkles },
  { href: "/brief", label: "Daily Brief", icon: Sun },
  { href: "/approvals", label: "אישורים", icon: ShieldCheck, countKey: "approvals" },
  { href: "/tasks", label: "משימות", icon: CheckSquare, countKey: "tasks" },
  { href: "/calendar", label: "יומן", icon: Calendar },
  { href: "/messages", label: "הודעות", icon: MessagesSquare },
  { href: "/documents", label: "מסמכים", icon: FileText },
  { href: "/automations", label: "אוטומציות", icon: Zap },
  { href: "/goals", label: "מטרות", icon: Target },
  { href: "/contacts", label: "אנשי קשר", icon: Users },
  { href: "/activity", label: "פעילות", icon: Activity },
  { href: "/memory", label: "זיכרון", icon: Brain },
  { href: "/integrations", label: "אינטגרציות", icon: Plug },
  { href: "/workspaces", label: "Workspaces", icon: Layers },
  { href: "/settings", label: "הגדרות", icon: Settings },
];
