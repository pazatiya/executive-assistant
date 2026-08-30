import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Local development uses libSQL (a SQLite file). When DB_DRIVER=supabase the
 * same Drizzle query layer runs against Postgres via drizzle-orm/postgres-js —
 * wire that in `createSupabaseDb()` once SUPABASE creds exist. The service layer
 * only depends on the exported `db`, so nothing else changes.
 */

declare global {
  // eslint-disable-next-line no-var
  var __ea_db__: ReturnType<typeof createLibsqlDb> | undefined;
}

function createLibsqlDb() {
  const client = createClient({ url: env.libsqlUrl });
  return drizzle(client, { schema });
}

export const db = globalThis.__ea_db__ ?? createLibsqlDb();
if (process.env.NODE_ENV !== "production") globalThis.__ea_db__ = db;

export { schema };
export type DB = typeof db;
