import type { Config } from "drizzle-kit";

// Turso auth token: its own env var, or embedded in LIBSQL_URL as ?authToken=…
const rawUrl = process.env.LIBSQL_URL ?? "file:./data/app.db";
const at = rawUrl.indexOf("authToken=");
const url = at === -1 ? rawUrl : rawUrl.slice(0, at).replace(/[?&]$/, "");
const authToken =
  process.env.LIBSQL_AUTH_TOKEN ??
  (at === -1 ? undefined : decodeURIComponent(rawUrl.slice(at + 10).split("&")[0]));

// Local development uses libSQL/SQLite. The canonical Postgres schema for
// Supabase lives in supabase/migrations/*.sql (with RLS policies).
export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: { url, authToken },
  verbose: true,
  strict: true,
} satisfies Config;
