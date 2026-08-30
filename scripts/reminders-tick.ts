/**
 * Reminder engine tick. Run from cron / a scheduled task:
 *   * /5 * * * *  cd ~/executive-assistant && npm run reminders:tick
 * Or hit POST /api/reminders/tick from an external scheduler.
 */
import "dotenv/config";
import { processDueReminders } from "../src/lib/services/reminders.ts";

const fired = await processDueReminders();
console.log(`✓ reminders tick — ${fired.length} fired`);
process.exit(0);
