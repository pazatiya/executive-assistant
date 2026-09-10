/**
 * Customer appointment reminders.
 *
 * ~3–4h before a booked haircut the assistant sends the customer a WhatsApp
 * reminder. Called from the scheduler tick (every ~5 min); each appointment is
 * reminded at most once (deduped via an activity-log row).
 */
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityLogs } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { listAppointments } from "@/lib/integrations/dalor-barber";
import { sendWhatsApp } from "@/lib/integrations/whatsapp-send";
import { metaWaConfigured, sendMetaTemplateNamed } from "@/lib/integrations/meta-whatsapp";
import { resolveWhatsAppTarget } from "@/lib/integrations/whatsapp-context";
import { logActivity } from "./activity";

const TZ = env.appTimezone;

/** Wall-clock "now" pieces in the app timezone. */
function localNow(now: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

function toMinutes(hm: string): number {
  const [h, m] = String(hm).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

async function alreadyReminded(apptId: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const rows = await db
    .select({ id: activityLogs.id })
    .from(activityLogs)
    .where(
      and(
        eq(activityLogs.tool, "appt_reminder"),
        eq(activityLogs.target, apptId),
        gte(activityLogs.createdAt, since),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export interface ApptReminderResult {
  appointmentId: string;
  name: string;
  time: string;
  outcome: "sent" | "failed" | "skipped_already";
}

export async function runAppointmentReminders(now = new Date()): Promise<ApptReminderResult[]> {
  const lead = env.apptReminderLeadHours;
  const { date, minutes } = localNow(now);
  const results: ApptReminderResult[] = [];

  const target = await resolveWhatsAppTarget();
  if (!target) return results; // no owner/workspace wired → nothing to attribute logs to

  // reminders only ever go out for today's remaining appointments
  const appts = await listAppointments({ date });

  for (const a of appts) {
    if (!a.phone) continue;
    const startMin = toMinutes(a.time);
    const minutesUntil = startMin - minutes;
    // window: between (lead) and (lead - 1) hours away → one 5-min tick catches it
    if (minutesUntil > lead * 60 || minutesUntil <= (lead - 1) * 60) continue;
    if (await alreadyReminded(a.id)) {
      results.push({ appointmentId: a.id, name: a.fullName, time: a.time, outcome: "skipped_already" });
      continue;
    }

    const first = (a.fullName || "").trim().split(/\s+/)[0] || "לקוח יקר";
    // A reminder for an appointment booked days ago is business-initiated and
    // outside the 24h service window — Meta only allows an approved template
    // there (a plain text send fails with error 131047 "Re-engagement message").
    // The template body already carries the full wording; {{1}}=name, {{2}}=time.
    const r = metaWaConfigured()
      ? await sendMetaTemplateNamed(env.metaReminderTemplate, a.phone, [first, a.time])
      : await sendWhatsApp(
          a.phone,
          `היי ${first}, תזכורת לתור שלך היום ב-${a.time} ב-DALOR ✂️\n` +
            `אם משהו השתנה — פשוט תכתוב לי כאן ונתאם מחדש. נתראה!`,
        );

    await logActivity({
      userId: target.userId,
      workspaceId: target.workspaceId,
      agent: "orchestrator",
      action: `תזכורת תור נשלחה ל-${a.fullName} (${a.time})`,
      tool: "appt_reminder",
      target: a.id,
      result: r.ok ? "success" : "failure",
      error: r.ok ? null : r.error,
    });
    results.push({
      appointmentId: a.id,
      name: a.fullName,
      time: a.time,
      outcome: r.ok ? "sent" : "failed",
    });
  }
  return results;
}
