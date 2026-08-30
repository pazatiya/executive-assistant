import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { devSessions, users, workspaces } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { id } from "@/lib/ids";

const COOKIE = "ea_session";
const DEV_EMAIL = "pazyairat@gmail.com";

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  timezone: string;
  locale: string;
};

/**
 * AUTH_DRIVER=dev: a single local user, auto-provisioned, session in a cookie.
 * AUTH_DRIVER=supabase: replace the body of `getCurrentUser` with a Supabase
 * `auth.getUser()` call — the rest of the app only consumes `AuthUser`.
 */
export async function getCurrentUser(): Promise<AuthUser> {
  if (env.authDriver === "supabase") {
    // TODO(phase-1+): wire @supabase/ssr createServerClient().auth.getUser()
    throw new Error("AUTH_DRIVER=supabase not wired yet — set AUTH_DRIVER=dev");
  }
  return getOrCreateDevUser();
}

export async function getOrCreateDevUser(): Promise<AuthUser> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;

  if (token) {
    const row = await db.query.devSessions.findFirst({ where: eq(devSessions.token, token) });
    if (row && new Date(row.expiresAt) > new Date()) {
      const u = await db.query.users.findFirst({ where: eq(users.id, row.userId) });
      if (u) return toAuthUser(u);
    }
  }

  // provision the local user on first run
  let u = await db.query.users.findFirst({ where: eq(users.email, DEV_EMAIL) });
  if (!u) {
    const uid = id("user");
    await db.insert(users).values({ id: uid, email: DEV_EMAIL, fullName: "פז" });
    u = await db.query.users.findFirst({ where: eq(users.id, uid) });
  }
  if (!u) throw new Error("failed to provision dev user");

  const newToken = id("sess");
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  await db.insert(devSessions).values({ token: newToken, userId: u.id, expiresAt: expires });
  try {
    jar.set(COOKIE, newToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  } catch {
    // cookies() is read-only in some RSC contexts; session still resolves by email next call
  }
  return toAuthUser(u);
}

function toAuthUser(u: typeof users.$inferSelect): AuthUser {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    timezone: u.timezone,
    locale: u.locale,
  };
}

/** The workspace the UI is currently scoped to (top-bar switcher), from a cookie. */
export async function getActiveWorkspaceId(userId: string): Promise<string> {
  const jar = await cookies();
  const fromCookie = jar.get("ea_workspace")?.value;
  if (fromCookie) {
    const ok = await db.query.workspaces.findFirst({ where: eq(workspaces.id, fromCookie) });
    if (ok && ok.ownerId === userId) return ok.id;
  }
  const first = await db.query.workspaces.findFirst({ where: eq(workspaces.ownerId, userId) });
  if (!first) throw new Error("no workspace for user — run npm run db:seed");
  return first.id;
}
