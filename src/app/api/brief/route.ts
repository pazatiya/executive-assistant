import { apiContext, ok, readJson } from "@/lib/api";
import { buildEndOfDayBrief, buildMorningBrief } from "@/lib/services/brief";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { id } from "@/lib/ids";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { user, workspaceId } = await apiContext(req);
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "morning";
  const scoped = url.searchParams.get("scope") === "workspace" ? workspaceId : undefined;
  const brief =
    kind === "eod" ? await buildEndOfDayBrief(user.id, scoped) : await buildMorningBrief(user.id, scoped);
  return ok(brief);
}

export async function POST(req: Request) {
  const { user } = await apiContext(req);
  const { kind } = await readJson<{ kind: "morning" | "eod" }>(req);

  if (kind === "eod") {
    const b = await buildEndOfDayBrief(user.id);
    await db.insert(notifications).values({
      id: id("ntf"),
      userId: user.id,
      kind: "brief",
      title: "סיכום סוף יום",
      body: `${b.completed.length} הושלמו · ${b.stillOpen.length} פתוחות · ${b.waiting.length} ממתינות${b.problems.length ? ` · ${b.problems.length} תקלות` : ""}`,
      href: "/brief",
      priority: "normal",
    });
  } else {
    const b = await buildMorningBrief(user.id);
    await db.insert(notifications).values({
      id: id("ntf"),
      userId: user.id,
      kind: "brief",
      title: "סקירת בוקר",
      body: `${b.openTasks.length} משימות · ${b.waitingApprovals.length} אישורים · ${b.newLeads.length} לידים${b.urgent.length ? ` · ${b.urgent.length} דחופים` : ""}`,
      href: "/brief",
      priority: b.urgent.length ? "high" : "normal",
    });
  }
  return ok({ sent: true });
}
