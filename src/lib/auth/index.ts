import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { devSessions, users, workspaces } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { id } from "@/lib/ids";
import { isMember, firstWorkspaceForUser } from "./scope";

const COOKIE = "ea_session";

/**
 * The people who use this assistant. AUTH_DRIVER=dev signs in as one of them
 * with a cookie session — no password (single household, local network).
 * AUTH_DRIVER=supabase would replace `getCurrentUser` with `auth.getUser()`.
 */
export const DEV_USERS = [
  { key: "paz", email: "pazyairat@gmail.com", fullName: "פז" },
  { key: "yair", email: "yair@dalor.co.il", fullName: "יאיר" },
] as const;

export type DevUserKey = (typeof DEV_USERS)[number]["key"];

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  timezone: string;
  locale: string;
};

export async function getCurrentUser(): Promise<AuthUser> {
  if (env.authDriver === "supabase") {
    throw new Error("AUTH_DRIVER=supabase not wired yet — set AUTH_DRIVER=dev");
  }
  return resolveDevUser();
}

async function resolveDevUser(): Promise<AuthUser> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;

  if (token) {
    const row = await db.query.devSessions.findFirst({ where: eq(devSessions.token, token) });
    if (row && new Date(row.expiresAt) > new Date()) {
      const u = await db.query.users.findFirst({ where: eq(users.id, row.userId) });
      if (u) return toAuthUser(u);
    }
  }

  // Deployed (APP_PASSWORD set): never auto-sign-in — the middleware sends the
  // visitor to /login, which checks the password.
  if (env.appPassword) {
    await ensureDevUsers();
    throw new Error("unauthorized — sign in at /login");
  }

  // Local dev — provision everyone and sign in as the first user.
  await ensureDevUsers();
  const u = await getUserByEmail(DEV_USERS[0].email);
  if (!u) throw new Error("failed to provision dev user");
  await writeSession(u.id).catch(() => {});
  return toAuthUser(u);
}

/** Provision every known dev user (id + name) if missing. Idempotent. */
export async function ensureDevUsers(): Promise<void> {
  for (const spec of DEV_USERS) {
    const existing = await db.query.users.findFirst({ where: eq(users.email, spec.email) });
    if (!existing) {
      await db.insert(users).values({ id: id("user"), email: spec.email, fullName: spec.fullName });
    }
  }
}

/** Sign in as a dev user by key. Sets the session cookie. */
export async function signInAs(key: string): Promise<AuthUser> {
  const spec = DEV_USERS.find((u) => u.key === key) ?? DEV_USERS[0];
  await ensureDevUsers();
  const u = await getUserByEmail(spec.email);
  if (!u) throw new Error(`failed to resolve dev user ${spec.email}`);
  await writeSession(u.id);
  return toAuthUser(u);
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.delete(devSessions).where(eq(devSessions.token, token));
  try {
    jar.delete(COOKIE);
  } catch {
    /* read-only cookie context */
  }
}

async function writeSession(userId: string): Promise<void> {
  const jar = await cookies();
  const token = id("sess");
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  await db.insert(devSessions).values({ token, userId, expiresAt: expires });
  jar.set(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
}

async function getUserByEmail(email: string) {
  return db.query.users.findFirst({ where: eq(users.email, email) });
}

function toAuthUser(u: typeof users.$inferSelect): AuthUser {
  return { id: u.id, email: u.email, fullName: u.fullName, timezone: u.timezone, locale: u.locale };
}

/** The workspace the UI is currently scoped to (top-bar switcher), from a cookie. */
export async function getActiveWorkspaceId(userId: string): Promise<string> {
  const jar = await cookies();
  const fromCookie = jar.get("ea_workspace")?.value;
  if (fromCookie) {
    const ok = await db.query.workspaces.findFirst({ where: eq(workspaces.id, fromCookie) });
    if (ok && (await isMember(userId, ok.id))) return ok.id;
  }
  const first = await firstWorkspaceForUser(userId);
  if (!first) throw new Error("no workspace for user — run npm run db:seed");
  return first;
}

/** Guard: assert a user belongs to a workspace before scoping to it. */
export async function assertMember(userId: string, workspaceId: string): Promise<void> {
  if (!(await isMember(userId, workspaceId))) {
    throw new Error("forbidden: not a member of this workspace");
  }
}
