import { PageHeader, PageBody } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { loadAppContext } from "@/lib/app-context";
import { listActivity } from "@/lib/services/activity";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const RESULT: Record<string, string> = { success: "הצלחה", failure: "כשל", info: "מידע", waiting: "ממתין" };

export default async function ActivityPage() {
  const { user } = await loadAppContext();
  const logs = await listActivity(user.id, { limit: 300 });

  return (
    <>
      <PageHeader
        title="מרכז פעילות"
        description="יומן audit מלא: כל פעולה, מי ביצע, האם אוטומטית, סיכון, סטטוס אישור ותוצאה."
      />
      <PageBody>
        <Card className="overflow-hidden">
          <div className="max-h-[calc(100vh-220px)] overflow-auto">
            <table className="min-w-[760px] w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-right text-xs text-muted-foreground">
                  <th className="p-3 font-medium">זמן</th>
                  <th className="p-3 font-medium">פעולה</th>
                  <th className="p-3 font-medium">סוכן</th>
                  <th className="p-3 font-medium">כלי</th>
                  <th className="p-3 font-medium">סיכון</th>
                  <th className="p-3 font-medium">אישור</th>
                  <th className="p-3 font-medium">תוצאה</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b last:border-0 align-top">
                    <td className="whitespace-nowrap p-3 text-xs text-muted-foreground">{formatDateTime(l.createdAt)}</td>
                    <td className="p-3">
                      {l.action}
                      {l.error && <div className="text-xs text-destructive">{l.error}</div>}
                    </td>
                    <td className="p-3 text-xs">{l.agent}</td>
                    <td className="p-3 text-xs text-muted-foreground">{l.tool ?? "—"}</td>
                    <td className="p-3">
                      {l.riskLevel === "none" ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <Badge variant={l.riskLevel as "green" | "yellow" | "red"}>{l.riskLevel.toUpperCase()}</Badge>
                      )}
                    </td>
                    <td className="p-3 text-xs">
                      {l.approvalStatus === "not_required" ? (
                        <span className="text-muted-foreground">לא נדרש</span>
                      ) : (
                        <span>
                          {l.approvalStatus}
                          {l.approvedBy ? ` · ${l.approvedBy}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <span
                        className={
                          l.result === "failure"
                            ? "text-destructive"
                            : l.result === "waiting"
                              ? "text-warning"
                              : l.result === "success"
                                ? "text-success"
                                : "text-muted-foreground"
                        }
                      >
                        {RESULT[l.result]}
                      </span>
                      {l.autoExecuted && <span className="mr-1 text-xs text-muted-foreground"> (אוטו׳)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </PageBody>
    </>
  );
}
