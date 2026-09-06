/**
 * The owners' command channel. פז + יאיר get briefs, reminders and approval
 * requests as WhatsApp messages on יאיר's line — יאיר as a self-chat, פז as a
 * normal message to her number. They reply "אשר A7" / "דחה A7" to decide.
 */
import { env } from "@/lib/env";
import { WahaConnector, normalizeChatId } from "@/lib/integrations/waha";
import { logActivity } from "./activity";

/**
 * OWNER_WHATSAPP entries are either a bare number ("972501234567") or
 * "email:number" ("yair@dalor.co.il:972501234567"). The email form lets the
 * scheduler send each owner their own brief.
 */
function parseOwnerEntries(): { email: string | null; number: string }[] {
  return env.ownerWhatsapp
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const m = entry.match(/^([^:]+@[^:]+):(.+)$/);
      if (m) return { email: m[1].toLowerCase().trim(), number: m[2].replace(/\D/g, "") };
      return { email: null, number: entry.replace(/\D/g, "") };
    })
    .filter((e) => e.number);
}

/** All owner WhatsApp numbers (E.164 digits). */
export function ownerNumbers(): string[] {
  return parseOwnerEntries().map((e) => e.number);
}

/** The WhatsApp number configured for a given owner email, if any. */
export function numberForEmail(email: string): string | null {
  const e = email.toLowerCase().trim();
  return parseOwnerEntries().find((x) => x.email === e)?.number ?? null;
}

/** Send one message to one number. Best-effort. */
export async function sendToNumber(number: string, text: string): Promise<boolean> {
  try {
    const r = await new WahaConnector().executeAction("send_message", {
      to: normalizeChatId(number),
      text,
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Is this inbound number one of the owners? (fromMe is handled by the caller) */
export function isOwnerNumber(number: string): boolean {
  const n = number.replace(/\D/g, "");
  return ownerNumbers().some((o) => o === n || o.endsWith(n) || n.endsWith(o));
}

export interface NotifyResult {
  sent: number;
  failed: number;
}

/** Send a plain message to every owner. Best-effort; never throws. */
export async function notifyOwners(
  text: string,
  opts: { userId?: string; workspaceId?: string | null; tag?: string } = {},
): Promise<NotifyResult> {
  const waha = new WahaConnector();
  let sent = 0;
  let failed = 0;
  for (const num of ownerNumbers()) {
    try {
      const r = await waha.executeAction("send_message", { to: normalizeChatId(num), text });
      if (r.ok) sent++;
      else failed++;
    } catch {
      failed++;
    }
  }
  if (opts.userId) {
    await logActivity({
      userId: opts.userId,
      workspaceId: opts.workspaceId ?? null,
      agent: "orchestrator",
      action: `הודעה לבעלים${opts.tag ? ` (${opts.tag})` : ""} — ${sent} נשלחו${failed ? `, ${failed} נכשלו` : ""}`,
      tool: "whatsapp",
      result: failed && !sent ? "failure" : "success",
    }).catch(() => {});
  }
  return { sent, failed };
}
