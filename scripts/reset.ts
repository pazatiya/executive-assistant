/** Drops the local database file and re-applies schema. Local dev only. */
import { existsSync, rmSync } from "node:fs";

const path = (process.env.LIBSQL_URL ?? "file:./data/app.db").replace(/^file:/, "");
for (const f of [path, `${path}-shm`, `${path}-wal`]) {
  if (existsSync(f)) {
    rmSync(f);
    console.log(`✗ removed ${f}`);
  }
}
console.log("✓ database reset — run `npm run db:push` then `npm run db:seed`");
process.exit(0);
