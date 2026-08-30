import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { integrationCredentials, integrations } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { nowIso } from "@/lib/utils";
import { env } from "@/lib/env";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { BaseConnector, type Capability, type Connector, type ConnectorActionResult } from "./connector";

const OAUTH_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN = "https://oauth2.googleapis.com/token";

export const GOOGLE_SCOPES: Record<string, string[]> = {
  gmail: [
    "openid",
    "email",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
  ],
  google_calendar: ["openid", "email", "https://www.googleapis.com/auth/calendar.events"],
  google_drive: ["openid", "email", "https://www.googleapis.com/auth/drive.file"],
};

export function googleConfigured() {
  return Boolean(env.googleOauthClientId && env.googleOauthClientSecret);
}

function redirectUri() {
  return `${env.appUrl}/api/integrations/google/callback`;
}

export function buildAuthUrl(provider: string, state: string) {
  const scopes = GOOGLE_SCOPES[provider] ?? GOOGLE_SCOPES.gmail;
  const params = new URLSearchParams({
    client_id: env.googleOauthClientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: scopes.join(" "),
    state,
  });
  return `${OAUTH_AUTH}?${params.toString()}`;
}

interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  obtained_at: number;
}

export async function exchangeCode(code: string): Promise<TokenSet> {
  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.googleOauthClientId,
      client_secret: env.googleOauthClientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${await res.text()}`);
  const t = (await res.json()) as TokenSet;
  return { ...t, obtained_at: Date.now() };
}

async function refresh(refreshToken: string): Promise<TokenSet> {
  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.googleOauthClientId,
      client_secret: env.googleOauthClientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${await res.text()}`);
  const t = (await res.json()) as TokenSet;
  return { ...t, refresh_token: refreshToken, obtained_at: Date.now() };
}

/** Persist tokens (encrypted) + flip the integration row to connected. */
export async function storeGoogleTokens(
  userId: string,
  provider: string,
  tokens: TokenSet,
  accountEmail: string,
) {
  const row = await db.query.integrations.findFirst({
    where: and(eq(integrations.userId, userId), eq(integrations.provider, provider), isNull(integrations.workspaceId)),
  });
  if (!row) throw new Error("integration row missing");

  await db.delete(integrationCredentials).where(eq(integrationCredentials.integrationId, row.id));
  await db.insert(integrationCredentials).values({
    id: id("cred"),
    integrationId: row.id,
    ciphertext: encryptJson(tokens),
    keyVersion: 1,
  });
  await db
    .update(integrations)
    .set({
      status: "connected",
      accountLabel: accountEmail,
      scopes: (GOOGLE_SCOPES[provider] ?? []) as string[],
      lastSyncedAt: nowIso(),
      lastError: null,
      updatedAt: nowIso(),
    })
    .where(eq(integrations.id, row.id));
}

async function validAccessToken(integrationId: string): Promise<string> {
  const cred = await db.query.integrationCredentials.findFirst({
    where: eq(integrationCredentials.integrationId, integrationId),
  });
  if (!cred) throw new Error("not connected");
  let tokens = decryptJson<TokenSet>(cred.ciphertext);
  const expired = Date.now() > tokens.obtained_at + (tokens.expires_in - 60) * 1000;
  if (expired && tokens.refresh_token) {
    tokens = await refresh(tokens.refresh_token);
    await db
      .update(integrationCredentials)
      .set({ ciphertext: encryptJson(tokens), updatedAt: nowIso() })
      .where(eq(integrationCredentials.id, cred.id));
  }
  return tokens.access_token;
}

/* ───────────────────────── Gmail connector ───────────────────────── */

const cap = (key: string, label: string, risk: Capability["risk"]): Capability => ({ key, label, risk });

export class GmailConnector extends BaseConnector {
  provider = "gmail";
  displayName = "Gmail";
  category = "email" as const;
  private integrationId: string | null = null;

  constructor(integrationId?: string | null) {
    super();
    this.integrationId = integrationId ?? null;
  }

  listCapabilities() {
    return [
      cap("read_email", "קריאת תיבה", "green"),
      cap("summarize_email", "סיכום", "green"),
      cap("draft_reply", "טיוטת תשובה", "green"),
      cap("send_email", "שליחת מייל", "yellow"),
      cap("archive_email", "ארכוב", "yellow"),
    ];
  }

  async connect() {
    if (!googleConfigured())
      return { message: "Google OAuth לא מוגדר. הוסיפי GOOGLE_OAUTH_CLIENT_ID / SECRET ל-.env.local (Google Cloud Console)." };
    return { redirectUrl: `/api/integrations/google/connect?provider=gmail`, message: "מפנה ל-Google לאישור הרשאות…" };
  }

  async testConnection() {
    try {
      if (!this.integrationId) return { ok: false, detail: "לא מחובר" };
      const token = await validAccessToken(this.integrationId);
      const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!r.ok) return { ok: false, detail: `Gmail API ${r.status}` };
      const p = (await r.json()) as { emailAddress: string; messagesTotal: number };
      return { ok: true, detail: `מחובר: ${p.emailAddress} (${p.messagesTotal} הודעות)` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  async fetchData(resource: string, params: Record<string, unknown> = {}) {
    if (!this.integrationId) return { ok: false, items: [], detail: "לא מחובר" };
    const token = await validAccessToken(this.integrationId);
    if (resource === "messages") {
      const q = (params.q as string) ?? "in:inbox newer_than:7d";
      const list = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${params.limit ?? 15}&q=${encodeURIComponent(q)}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      const { messages = [] } = (await list.json()) as { messages?: { id: string }[] };
      const items = await Promise.all(
        messages.slice(0, 15).map(async (m) => {
          const full = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
            { headers: { authorization: `Bearer ${token}` } },
          );
          const d = (await full.json()) as {
            id: string;
            snippet: string;
            threadId: string;
            payload: { headers: { name: string; value: string }[] };
          };
          const h = (n: string) => d.payload.headers.find((x) => x.name === n)?.value ?? "";
          return { id: d.id, threadId: d.threadId, from: h("From"), subject: h("Subject"), date: h("Date"), snippet: d.snippet };
        }),
      );
      return { ok: true, items };
    }
    return { ok: false, items: [], detail: `resource לא נתמך: ${resource}` };
  }

  async executeAction(action: string, payload: Record<string, unknown>): Promise<ConnectorActionResult> {
    if (!this.integrationId) return { ok: false, detail: "", error: "Gmail לא מחובר" };
    const token = await validAccessToken(this.integrationId);

    if (action === "send_email") {
      const to = String(payload.to ?? "");
      const subject = String(payload.subject ?? "");
      const body = String(payload.body ?? "");
      const raw = Buffer.from(
        [`To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=UTF-8", "", body].join("\r\n"),
      )
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
      const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ raw, threadId: payload.threadId }),
      });
      if (!r.ok) return { ok: false, detail: "", error: `Gmail send ${r.status}: ${await r.text()}` };
      const sent = (await r.json()) as { id: string };
      return { ok: true, detail: "המייל נשלח דרך Gmail", data: { id: sent.id } };
    }

    if (action === "archive_email") {
      const r = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${payload.externalId}/modify`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
        },
      );
      return r.ok ? { ok: true, detail: "אורכב ב-Gmail" } : { ok: false, detail: "", error: `Gmail ${r.status}` };
    }

    return { ok: false, detail: "", error: `פעולה לא נתמכת: ${action}` };
  }
}

export function makeGoogleConnector(provider: string, integrationId: string | null): Connector | null {
  if (provider === "gmail") return new GmailConnector(integrationId);
  return null;
}
