/**
 * Time-driven jobs: fires each owner's brief 2–3× a day on their configured
 * schedule. Called from /api/scheduler/tick (cron, every ~5 min). Idempotent —
 * a brief of a given kind is sent at most once per owner per day.
 */
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications, users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { id } from "@/lib/ids";
import { DEV_USERS } from "@/lib/auth";
import { myWorkspaceIds } from "@/lib/auth/scope";
import { buildMorningBrief, buildMiddayBrief, buildEndOfDayBrief } from "./brief";
import { numberForEmail, sendToNumber } from "./notify-owner";
import { logActivity } from "./activity";

type BriefKind = "morning" | "midday" | "eod";

const PREF_KEY: Record<BriefKind, string> = {
  morning: "morningBriefAt",
  midday: "middayBriefAt",
  eod: "endOfDayBriefAt",
};
const DEFAULT_AT: Record<BriefKind, string> = { morning: "07:30", midday: "13:30", eod: "18:30" };
const LABEL: Record<BriefKind, string> = { morning: "סיכום בוקר", midday: "עדכון צהריים", eod: "סיכום ערב" };

/** "HH:MM" and "YYYY-MM-DD" in the app timezone. */
function localParts(now = new Date()): { hm: string; date: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: env.appTimezone,
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  const hm = `${p.hour}:${p.minute}`;
  return {
    hm,
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

function toMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

async function alreadySent(userId: string, kind: BriefKind, date: string): Promise<boolean> {
  const since = new Date(Date.now() - 20 * 3600_000).toISOString();
  const rows = await db
    .select({ id: notifications.id, title: notifications.title })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.kind, "brief"), gte(notifications.createdAt, since)))
    .orderBy(desc(notifications.createdAt))
    .limit(20);
  return rows.some((r) => r.title.includes(`${LABEL[kind]} · ${date}`));
}

function fmtMorning(b: Awaited<ReturnType<typeof buildMorningBrief>>): string {
  const L: string[] = ["☀️ *סיכום בוקר*"];
  if (b.urgent.length) L.push("\n🔴 דחוף:\n" + b.urgent.map((u) => `• ${u}`).join("\n"));
  if (b.meetingsToday.length)
    L.push("\n📅 היום:\n" + b.meetingsToday.map((m) => `• ${m.title}`).join("\n"));
  if (b.waitingApprovals.length)
    L.push(
      "\n✅ אישורים ממתינים:\n" +
        b.waitingApprovals.map((a) => `• ${a.title}`).join("\n"),
    );
  if (b.newLeads.length) L.push(`\n🎯 ${b.newLeads.length} לידים חדשים`);
  if (b.overdueTasks.length)
    L.push("\n⏰ באיחור:\n" + b.overdueTasks.map((t) => `• ${t.title}`).join("\n"));
  if (b.suggestedOrder.length)
    L.push("\n📌 סדר מוצע:\n" + b.suggestedOrder.slice(0, 5).map((s, i) => `${i + 1}. ${s}`).join("\n"));
  if (L.length === 1) L.push("\nיום פנוי יחסית — אין דברים דחופים 🙂");
  return L.join("\n");
}

function fmtMidday(b: Awaited<ReturnType<typeof buildMiddayBrief>>): string {
  const L: string[] = ["🕐 *עדכון צהריים*"];
  if (b.newSinceMorning.length)
    L.push(
      `\n📨 נכנס מהבוקר (${b.newSinceMorning.length}):\n` +
        b.newSinceMorning.slice(0, 6).map((m) => `• ${m.from}: ${m.text}`).join("\n"),
    );
  if (b.waitingApprovals.length)
    L.push(
      "\n✅ ממתין לאישור:\n" +
        b.waitingApprovals.map((a) => `• ${a.shortCode ? `[${a.shortCode}] ` : ""}${a.title}`).join("\n"),
    );
  if (b.awaitingReply.length) L.push(`\n💬 ${b.awaitingReply.length} הודעות בלי מענה`);
  if (L.length === 1) L.push("\nשקט יחסי — הכול מטופל 🙂");
  return L.join("\n");
}

function fmtEod(b: Awaited<ReturnType<typeof buildEndOfDayBrief>>): string {
  const L: string[] = ["🌙 *סיכום ערב*"];
  if (b.completed.length) L.push(`\n✔️ נסגר היום (${b.completed.length}):\n` + b.completed.slice(0, 8).map((t) => `• ${t.title}`).join("\n"));
  if (b.waiting.length) L.push("\n⏳ ממתין:\n" + b.waiting.map((t) => `• ${t.title}`).join("\n"));
  if (b.stillOpen.length) L.push(`\n📂 ${b.stillOpen.length} משימות פתוחות`);
  if (b.problems.length) L.push("\n⚠️ תקלות:\n" + b.problems.map((p) => `• ${p}`).join("\n"));
  if (b.suggestionsForTomorrow.length)
    L.push("\n➡️ למחר:\n" + b.suggestionsForTomorrow.map((s) => `• ${s}`).join("\n"));
  return L.join("\n");
}

async function briefTextFor(userId: string, kind: BriefKind): Promise<string> {
  // "personal" business context: pass no workspaceId → cross-workspace scope
  if (kind === "morning") return fmtMorning(await buildMorningBrief(userId));
  if (kind === "midday") return fmtMidday(await buildMiddayBrief(userId));
  return fmtEod(await buildEndOfDayBrief(userId));
}

export interface BriefRunResult {
  user: string;
  kind: BriefKind;
  outcome: "sent" | "notified_only" | "skipped_already" | "not_due";
}

/** Send any briefs now due, for every owner. */
export async function runDueBriefs(now = new Date()): Promise<BriefRunResult[]> {
  const { minutes, date } = localParts(now);
  const results: BriefRunResult[] = [];

  for (const spec of DEV_USERS) {
    const u = await db.query.users.findFirst({ where: eq(users.email, spec.email) });
    if (!u) continue;
    // this owner has to belong to at least one workspace to have anything to say
    if (!(await myWorkspaceIds(u.id)).length) continue;
    const prefs = (u.preferences ?? {}) as Record<string, string>;

    for (const kind of ["morning", "midday", "eod"] as BriefKind[]) {
      const at = prefs[PREF_KEY[kind]] || DEFAULT_AT[kind];
      const dueMin = toMinutes(at);
      // fire within a 90-min window after the target time (covers cron gaps)
      if (minutes < dueMin || minutes > dueMin + 90) {
        results.push({ user: spec.email, kind, outcome: "not_due" });
        continue;
      }
      if (await alreadySent(u.id, kind, date)) {
        results.push({ user: spec.email, kind, outcome: "skipped_already" });
        continue;
      }

      const text = await briefTextFor(u.id, kind);
      await db.insert(notifications).values({
        id: id("ntf"),
        userId: u.id,
        workspaceId: null,
        kind: "brief",
        title: `${LABEL[kind]} · ${date}`,
        body: text.slice(0, 2000),
        href: "/brief",
        priority: "normal",
      });

      const number = numberForEmail(spec.email);
      let outcome: BriefRunResult["outcome"] = "notified_only";
      if (number && (await sendToNumber(number, text))) outcome = "sent";

      await logActivity({
        userId: u.id,
        agent: "orchestrator",
        action: `${LABEL[kind]} ${outcome === "sent" ? "נשלח בוואטסאפ" : "נשמר כהתראה"}`,
        tool: "scheduler",
        result: "success",
      });
      results.push({ user: spec.email, kind, outcome });
    }
  }
  return results;
}
