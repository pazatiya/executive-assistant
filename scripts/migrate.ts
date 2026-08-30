/** Applies the generated Drizzle migrations to the local libSQL database. */
import "dotenv/config";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "../src/lib/db/index.ts";

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("✓ migrations applied");
process.exit(0);
