import { Badge } from "@/components/ui/badge";

export function RiskBadge({ level }: { level: "green" | "yellow" | "red" | "none" | string }) {
  if (level === "green") return <Badge variant="green">GREEN · אוטומטי</Badge>;
  if (level === "yellow") return <Badge variant="yellow">YELLOW · אישור</Badge>;
  if (level === "red") return <Badge variant="red">RED · אישור חובה</Badge>;
  return <Badge>—</Badge>;
}

const PRIORITY: Record<string, { label: string; cls: string }> = {
  low: { label: "נמוך", cls: "text-muted-foreground" },
  normal: { label: "רגיל", cls: "" },
  high: { label: "גבוה", cls: "text-warning" },
  urgent: { label: "דחוף", cls: "text-destructive font-semibold" },
};

export function PriorityTag({ value }: { value: string }) {
  const p = PRIORITY[value] ?? PRIORITY.normal;
  return <span className={`text-xs ${p.cls}`}>{p.label}</span>;
}

export function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`inline-block size-2 rounded-full ${ok ? "bg-success" : "bg-muted-foreground/40"}`} />;
}
