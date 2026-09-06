import { and, eq, or, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { memories, senderRules } from "@/lib/db/schema";
import { myWorkspaceIds } from "@/lib/auth/scope";

export type RiskLevel = "green" | "yellow" | "red";

/** Every action the assistant can propose, with its baseline risk. */
export const ACTION_CATALOG = {
  // ── GREEN: read / analyse / draft only ────────────────────────────
  read_data: "green",
  search: "green",
  summarize: "green",
  analyze_document: "green",
  check_calendar: "green",
  draft_reply: "green",
  draft_post: "green",
  create_task: "green",
  create_reminder: "green", // when explicitly requested by the user
  detect_spam: "green",
  propose_plan: "green",
  auto_reply_routine: "green", // a canned answer to a whitelisted routine question

  check_availability: "green", // read barber calendar

  // ── YELLOW: outward actions, gated by user-configured permission ──
  send_email: "yellow",
  reply_message: "yellow",
  post_social: "yellow",
  update_event: "yellow",
  create_event: "yellow",
  contact_client: "yellow",
  follow_up: "yellow",
  update_crm: "yellow",
  book_appointment: "yellow",
  archive_email: "yellow",
  delete_email: "yellow",
  browser_action: "yellow",
  upload_file: "yellow",

  // ── RED: money / legal / irreversible / permissions ─────────────
  make_payment: "red",
  purchase: "red",
  issue_refund: "red",
  transfer_funds: "red",
  pay_invoice: "red",
  change_price: "red",
  financial_commitment: "red",
  sign_agreement: "red",
  delete_significant_data: "red",
  delete_account: "red",
  change_permissions: "red",
  send_sensitive_info: "red",
  cancel_event: "red", // affects another person
} as const satisfies Record<string, RiskLevel>;

export type ActionType = keyof typeof ACTION_CATALOG;

export interface ClassifyInput {
  userId: string;
  workspaceId: string | null;
  actionType: ActionType | string;
  targetSystem?: string;
  /** e.g. the recipient address / handle, for sender-rule & memory-rule lookups. */
  target?: string;
  /** agent autonomy from agent_settings: suggest_only | act_on_green | act_on_yellow */
  agentAutonomy?: "suggest_only" | "act_on_green" | "act_on_yellow";
  /** negative sentiment / complaint always forces approval regardless of type */
  negativeSentiment?: boolean;
  /** triage intent bucket — routine buckets on the closed allowlist may auto-reply */
  intentCategory?: string;
}

/** Customer-message intents the assistant may answer on its own — closed list. */
export const AUTO_REPLY_INTENTS = new Set([
  "opening_hours",
  "location",
  "barber_pricelist",
  "appointment_availability",
  "appointment_confirm",
]);

export interface ClassifyResult {
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  autoExecutable: boolean;
  reason: string;
  matchedRules: string[];
}

/**
 * The single decision point. Nothing outward happens without passing through
 * here. Order of precedence:
 *   1. RED baseline           → always approval, never auto
 *   2. permanent memory rules  → can raise (never lower a RED)
 *   3. negative sentiment      → force approval
 *   4. sender rules (email)    → may allow auto-reply for a specific sender
 *   5. agent autonomy          → may auto-run GREEN / YELLOW
 */
export async function classifyAction(input: ClassifyInput): Promise<ClassifyResult> {
  const baseline = (ACTION_CATALOG as Record<string, RiskLevel>)[input.actionType] ?? "yellow";
  const matched: string[] = [];

  // 1. RED is absolute
  if (baseline === "red") {
    return {
      riskLevel: "red",
      requiresApproval: true,
      autoExecutable: false,
      reason: `פעולה מסוג "${input.actionType}" מסווגת RED — כסף / התחייבות / בלתי הפיכה. תמיד דורשת אישור מפורש.`,
      matchedRules: ["baseline:red"],
    };
  }

  let level: RiskLevel = baseline;
  let requiresApproval = baseline === "yellow";
  let reason =
    baseline === "green"
      ? "פעולת GREEN — קריאה / ניתוח / הכנת טיוטה. ניתנת לביצוע אוטומטי."
      : "פעולת YELLOW — פעולה כלפי חוץ. דורשת אישור אלא אם הגדרת אחרת.";

  // 2. permanent memory rules — mine, global, or set by anyone in a workspace I share
  const wsIds = await myWorkspaceIds(input.userId);
  const rules = await db.query.memories.findMany({
    where: and(
      eq(memories.type, "permanent"),
      or(
        isNull(memories.workspaceId),
        eq(memories.userId, input.userId),
        input.workspaceId ? eq(memories.workspaceId, input.workspaceId) : undefined,
        wsIds.length ? or(...wsIds.map((w) => eq(memories.workspaceId, w))) : undefined,
      ),
    ),
  });
  for (const r of rules) {
    if (!r.ruleKind) continue;
    const targetMatch =
      !r.ruleTarget ||
      (input.target && input.target.toLowerCase().includes(r.ruleTarget.toLowerCase())) ||
      r.ruleTarget === input.actionType ||
      r.ruleTarget === input.targetSystem;

    if (r.ruleKind === "always_require_approval" && targetMatch) {
      requiresApproval = true;
      matched.push(`memory:${r.id}`);
      reason = `כלל קבוע: "${r.subject}" — נדרש אישור.`;
    }
    if (r.ruleKind === "never_delete_from" && targetMatch && /delete|archive/.test(input.actionType)) {
      requiresApproval = true;
      level = "red";
      matched.push(`memory:${r.id}`);
      reason = `כלל קבוע: אין למחוק/לארכב מ-${r.ruleTarget}. נדרש אישור מפורש.`;
    }
    if (r.ruleKind === "do_not" && targetMatch) {
      requiresApproval = true;
      matched.push(`memory:${r.id}`);
      reason = `כלל קבוע: "${r.subject}". נדרש אישור.`;
    }
  }

  // 3. negative sentiment / complaint
  if (input.negativeSentiment && ["reply_message", "post_social", "send_email"].includes(input.actionType)) {
    requiresApproval = true;
    matched.push("policy:negative-sentiment");
    reason = "התגובה מופנית לפנייה שלילית / תלונה — תמיד עוברת אישור.";
  }

  // 4. sender rules (email replies)
  if (input.actionType === "send_email" && input.target) {
    const sr = await db.query.senderRules.findFirst({
      where: and(eq(senderRules.userId, input.userId), eq(senderRules.sender, input.target)),
    });
    if (sr) {
      matched.push(`sender_rule:${sr.id}`);
      if (sr.autoReplyAllowed && !sr.approvalRequired && !requiresApproval) {
        requiresApproval = false;
        reason = `כלל שולח: מותר להשיב אוטומטית ל-${sr.sender}.`;
      } else if (sr.approvalRequired) {
        requiresApproval = true;
        reason = `כלל שולח: תשובות ל-${sr.sender} דורשות אישור.`;
      }
    }
  }

  // 5. agent autonomy
  const autonomy = input.agentAutonomy ?? "act_on_green";
  let autoExecutable = false;
  if (!requiresApproval) {
    if (level === "green" && (autonomy === "act_on_green" || autonomy === "act_on_yellow")) autoExecutable = true;
    if (level === "yellow" && autonomy === "act_on_yellow") autoExecutable = true;
  }
  if (autonomy === "suggest_only") autoExecutable = false;

  return {
    riskLevel: level,
    requiresApproval: requiresApproval || !autoExecutable,
    autoExecutable,
    reason,
    matchedRules: matched.length ? matched : [`baseline:${baseline}`],
  };
}
