/**
 * Owner self-notes on WhatsApp. When פז or יאיר write to the assistant's line
 * (self-chat, or their own number) something that isn't an approval command,
 * treat it as an instruction: create a reminder / task in their personal space,
 * and confirm back.
 *
 *   "תזכיר לי שמחר ב-11 יש לי תור לרופא"  → reminder tomorrow 11:00
 *   "צריך להזמין מגבות למספרה"             → task
 *   "אל תשכח להתקשר לספק"                  → task
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, workspaces, workspaceMembers } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { createReminder } from "@/lib/services/reminders";
import { createTask } from "@/lib/services/tasks";
import { parseWhen } from "./date-parse";
import { parseAppointmentDate, parseAppointmentTime } from "./appointment-helper";
import { getConnectedNumber } from "@/lib/integrations/waha";

const REMIND_RE = /תזכיר|תזכורת|תזכור|remind|אל תיתן לי לשכוח/i;
const TASK_RE = /צריך ל|תדאג|תטפל|אל תשכח|לא לשכוח|משימה|תעשה|to ?do|task/i;

/** Resolve the owner user id for an inbound WhatsApp sender. */
export async function resolveOwnerUser(fromNumber: string, fromMe: boolean): Promise<string | null> {
  const digits = fromNumber.replace(/\D/g, "");

  // OWNER_WHATSAPP entries as "email:number"
  for (const entry of env.ownerWhatsapp.split(",").map((s) => s.trim())) {
    const m = entry.match(/^([^:]+@[^:]+):(.+)$/);
    if (!m) continue;
    const num = m[2].replace(/\D/g, "");
    if (num && (num === digits || num.endsWith(digits) || digits.endsWith(num))) {
      const u = await db.query.users.findFirst({ where: eq(users.email, m[1].toLowerCase()) });
      if (u) return u.id;
    }
  }

  // self-chat: whoever the WAHA line is linked to
  if (fromMe) {
    const connected = (await getConnectedNumber())?.replace(/\D/g, "");
    for (const entry of env.ownerWhatsapp.split(",").map((s) => s.trim())) {
      const m = entry.match(/^([^:]+@[^:]+):(.+)$/);
      if (m && connected && m[2].replace(/\D/g, "") === connected) {
        const u = await db.query.users.findFirst({ where: eq(users.email, m[1].toLowerCase()) });
        if (u) return u.id;
      }
    }
    // last resort — the configured owner
    const u = await db.query.users.findFirst({ where: eq(users.email, env.whatsappOwnerEmail) });
    return u?.id ?? null;
  }

  return null;
}

/** That user's personal workspace (type personal), else null. */
async function personalWorkspaceId(userId: string): Promise<string | null> {
  const rows = await db
    .select({ id: workspaces.id, type: workspaces.type })
    .from(workspaces)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, userId));
  return rows.find((r) => r.type === "personal")?.id ?? rows[0]?.id ?? null;
}

function parseDateTime(text: string): string | null {
  const date = parseAppointmentDate(text);
  const time = parseAppointmentTime(text);
  if (date) {
    const [h, m] = (time ?? "09:00").split(":").map(Number);
    const d = new Date(`${date}T00:00:00`);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  }
  return parseWhen(text);
}

/** Strip the command words so the reminder title reads cleanly. */
function cleanTitle(text: string): string {
  const cleaned = text
    .replace(REMIND_RE, "")
    .replace(/^\s*(לי|לו|לה)\s+/, "")
    .replace(/^\s*ש(?=[א-ת])/, "")
    .replace(/\b(יש לי|יש לו|יש לה|צריך)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || text.trim();
}

/** Strip "צריך ל / תדאג ש / אל תשכח ל" prefixes without eating the verb. */
function cleanTaskTitle(text: string): string {
  const cleaned = text
    .replace(/^\s*(צריך|תדאג|תטפל|אל תשכח|לא לשכוח|תעשה)\s*(ל|ש|ב)?\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || text.trim();
}

export interface OwnerNoteResult {
  handled: boolean;
  reply?: string;
}

export async function handleOwnerNote(text: string, ownerUserId: string): Promise<OwnerNoteResult> {
  const t = text.trim();
  if (t.length < 3) return { handled: false };

  const wsId = await personalWorkspaceId(ownerUserId);
  const isRemind = REMIND_RE.test(t);
  const isTask = TASK_RE.test(t);
  if (!isRemind && !isTask) return { handled: false };

  if (isRemind) {
    const dueAt = parseDateTime(t);
    const title = cleanTitle(t).slice(0, 200);
    if (!dueAt) {
      const r = await createReminder({
        userId: ownerUserId,
        workspaceId: wsId,
        title,
        kind: "one_time",
        dueAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      return { handled: true, reply: `רשמתי תזכורת: "${title}" (בלי זמן ברור — שים לי שעה ואעדכן). #${r.id.slice(-4)}` };
    }
    const when = new Date(dueAt);
    const r = await createReminder({
      userId: ownerUserId,
      workspaceId: wsId,
      title,
      kind: when.getTime() - Date.now() > 20 * 3600_000 ? "pre_event" : "one_time",
      dueAt,
    });
    const whenStr = when.toLocaleString("he-IL", {
      timeZone: env.appTimezone,
      weekday: "short",
      day: "numeric",
      month: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    return { handled: true, reply: `✅ תזכורת ל-${whenStr}: ${title}` };
  }

  // task
  const title = cleanTaskTitle(t).slice(0, 200);
  const task = await createTask({
    userId: ownerUserId,
    workspaceId: wsId ?? "",
    title,
    createdBy: "user",
    source: "whatsapp:self-note",
    priority: /דחוף|היום|עכשיו/.test(t) ? "high" : "normal",
  });
  return { handled: true, reply: `✅ נוספה משימה: ${task.title}` };
}
