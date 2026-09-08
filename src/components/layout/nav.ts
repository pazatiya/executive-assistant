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

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "מרכז עבודה",
    items: [
      { href: "/dashboard", label: "ראשי", icon: LayoutDashboard },
      { href: "/assistant", label: "המזכירה", icon: Sparkles },
      { href: "/brief", label: "תדריך יומי", icon: Sun },
    ],
  },
  {
    label: "ניהול",
    items: [
      { href: "/tasks", label: "משימות", icon: CheckSquare, countKey: "tasks" },
      { href: "/messages", label: "הודעות", icon: MessagesSquare },
      { href: "/calendar", label: "יומן", icon: Calendar },
      { href: "/approvals", label: "אישורים", icon: ShieldCheck, countKey: "approvals" },
      { href: "/goals", label: "מטרות", icon: Target },
      { href: "/contacts", label: "אנשי קשר", icon: Users },
      { href: "/documents", label: "מסמכים", icon: FileText },
    ],
  },
  {
    label: "כלים ומערכת",
    items: [
      { href: "/automations", label: "אוטומציות", icon: Zap },
      { href: "/activity", label: "מרכז פעילות", icon: Activity },
      { href: "/memory", label: "זיכרון", icon: Brain },
      { href: "/integrations", label: "אינטגרציות", icon: Plug },
      { href: "/workspaces", label: "סביבות עבודה", icon: Layers },
      { href: "/settings", label: "הגדרות", icon: Settings },
    ],
  },
];
