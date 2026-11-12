/**
 * Facebook Messenger + Instagram DMs via the Meta Graph API.
 *
 * Same Meta app and webhook URL as WhatsApp (/api/webhooks/meta); the payload
 * differs: `object` is "page" (Messenger) or "instagram", with
 * `entry[].messaging[]` events instead of WhatsApp's `entry[].changes[]`.
 * Replies are `POST /{page-id}/messages` with the Page access token — for
 * Instagram too, the Page that the Instagram professional account is linked to.
 *
 * Standard messaging rule (like WhatsApp's 24h window): a business can reply
 * to a person only within 24 hours of THEIR last message. Our auto-reply is
 * immediate, and an owner replying from the app is almost always in time; a
 * late reply fails with a clear Meta error that we surface instead of hiding.
 */
import { env } from "@/lib/env";

export type SocialChannel = "instagram" | "facebook";

export interface SocialInbound {
  channel: SocialChannel;
  /** Meta message id (mid) — used for dedup. */
  externalId: string;
  /** Page-scoped (Messenger) or Instagram-scoped user id of the person writing. */
  senderId: string;
  text: string;
  receivedAt: string;
}

export function metaSocialConfigured(): boolean {
  return Boolean(env.metaPageToken && env.metaPageId);
}

const graphBase = () => `https://graph.facebook.com/${env.metaGraphVersion}`;

interface MessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    is_unsupported?: boolean;
    attachments?: { type?: string; payload?: { url?: string } }[];
    reply_to?: { story?: unknown };
  };
}
interface SocialWebhook {
  object?: string;
  entry?: { id?: string; time?: number; messaging?: MessagingEvent[] }[];
}

const ATTACHMENT_LABEL: Record<string, string> = {
  image: "תמונה מצורפת",
  video: "סרטון מצורף",
  audio: "הודעה קולית",
  file: "קובץ מצורף",
  share: "פוסט ששותף",
  story_mention: "תיוג בסטורי",
  ig_reel: "ריל ששותף",
  reel: "ריל ששותף",
  like_heart: "לב",
};

/**
 * Pure parser: turns a Meta "page"/"instagram" webhook body into the messages
 * worth handling. Skips our own outbound echoes, deletions, other pages /
 * Instagram accounts that share this webhook, and events with nothing to say.
 */
export function parseSocialWebhook(raw: unknown, cfg = { pageId: env.metaPageId, igId: env.metaIgId }): SocialInbound[] {
  const evt = raw as SocialWebhook;
  const channel: SocialChannel | null = evt?.object === "instagram" ? "instagram" : evt?.object === "page" ? "facebook" : null;
  if (!channel) return [];
  const ownId = channel === "instagram" ? cfg.igId : cfg.pageId;
  const out: SocialInbound[] = [];
  for (const entry of evt.entry ?? []) {
    // the webhook is app-wide: only act on events for OUR Page / Instagram account
    if (ownId && entry.id && entry.id !== ownId) continue;
    for (const ev of entry.messaging ?? []) {
      const m = ev.message;
      const senderId = ev.sender?.id;
      if (!m || !senderId || !m.mid) continue;
      if (m.is_echo || m.is_deleted) continue; // our own replies / unsent messages
      if (senderId === (ownId || entry.id)) continue; // never answer ourselves
      let text = (m.text ?? "").trim();
      if (!text) {
        const att = m.attachments?.[0]?.type;
        if (!att && !m.is_unsupported) continue;
        text = `[${ATTACHMENT_LABEL[att ?? ""] ?? "הודעה שלא נתמכת"} — לא ניתן להציג כאן, נא לבדוק באפליקציית ${channel === "instagram" ? "אינסטגרם" : "פייסבוק"}]`;
      }
      out.push({
        channel,
        externalId: String(m.mid),
        senderId: String(senderId),
        text,
        receivedAt: new Date(ev.timestamp ?? entry.time ?? Date.now()).toISOString(),
      });
    }
  }
  return out;
}

/**
 * Best-effort display name for a sender. A direct GET /{sender-id}?fields=name is
 * refused for our token (it needs a profile-access feature Meta gates behind app
 * review), but the Page's conversation with that person lists its participants with
 * their name (Messenger) / username (Instagram) — which works today.
 */
export async function fetchSocialProfile(channel: SocialChannel, senderId: string): Promise<string | null> {
  if (!metaSocialConfigured()) return null;
  try {
    const q = new URLSearchParams({ user_id: senderId, fields: "participants" });
    if (channel === "instagram") q.set("platform", "instagram");
    const res = await fetch(`${graphBase()}/${env.metaPageId}/conversations?${q}`, {
      headers: { Authorization: `Bearer ${env.metaPageToken}` },
    });
    if (!res.ok) return null;
    const j = (await res.json().catch(() => null)) as {
      data?: { participants?: { data?: { id?: string; name?: string; username?: string }[] } }[];
    } | null;
    const p = j?.data?.[0]?.participants?.data?.find((x) => x.id === senderId);
    if (!p) return null;
    if (channel === "instagram") return p.username ? `@${p.username}` : null;
    return p.name?.trim() || null;
  } catch {
    return null;
  }
}

/** Reply to a person on Messenger / Instagram. Returns Meta's real error text on failure. */
export async function sendSocialMessage(
  _channel: SocialChannel,
  recipientId: string,
  text: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!metaSocialConfigured()) return { ok: false, error: "פייסבוק/אינסטגרם לא מוגדרים (META_PAGE_ID / META_PAGE_TOKEN)" };
  try {
    const res = await fetch(`${graphBase()}/${env.metaPageId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.metaPageToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: "RESPONSE",
        message: { text: text.slice(0, 1000) }, // Meta's text limit is 2000 bytes; Hebrew is 2 bytes/char
      }),
    });
    const body = (await res.json().catch(() => null)) as
      | { message_id?: string; error?: { message?: string; code?: number; error_subcode?: number } }
      | null;
    if (!res.ok || body?.error) {
      const e = body?.error;
      const error = e?.message ?? `HTTP ${res.status}`;
      console.error(`[meta-social] send to ${recipientId} FAILED: ${error} (code ${e?.code ?? "?"}/${e?.error_subcode ?? "?"})`);
      // 24h rule: error code 10 / subcode 2534022 = outside the allowed window
      if (e?.code === 10 || e?.error_subcode === 2534022) {
        return { ok: false, error: "עברו יותר מ-24 שעות מההודעה האחרונה של הלקוח — פייסבוק/אינסטגרם לא מאפשרים לענות אחרי כן" };
      }
      return { ok: false, error };
    }
    console.log(`[meta-social] send to ${recipientId} ok, id=${body?.message_id}`);
    return { ok: true, id: body?.message_id };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[meta-social] send to ${recipientId} threw: ${error}`);
    return { ok: false, error };
  }
}
