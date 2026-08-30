import type { Config } from "drizzle-kit";

// Local development uses libSQL/SQLite. The canonical Postgres schema for
// Supabase lives in supabase/migrations/*.sql (with RLS policies).
export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: process.env.LIBSQL_URL ?? "file:./data/app.db",
  },
  verbose: true,
  strict: true,
} satisfies Config;
