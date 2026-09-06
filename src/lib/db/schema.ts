/**
 * Executive Assistant — database schema (libSQL / SQLite dialect for local dev).
 *
 * The canonical Postgres schema for Supabase — identical shape, plus Row Level
 * Security policies — lives in `supabase/migrations/`. Keep the two in sync.
 *
 * Conventions:
 *  - ids: nanoid text, generated in the service layer
 *  - timestamps: ISO-8601 text (UTC), default CURRENT_TIMESTAMP
 *  - json blobs: text with { mode: "json" }
 *  - enums: text + $type<> (SQLite has no native enum; Postgres migration uses CHECK)
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

const timestamps = {
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
};

/* ───────────────────────────── identity ───────────────────────────── */

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull().default(""),
  avatarUrl: text("avatar_url"),
  timezone: text("timezone").notNull().default("Asia/Jerusalem"),
  locale: text("locale").notNull().default("he"),
  // per-user global preferences (writing style defaults, brief times, etc.)
  preferences: text("preferences", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
  ...timestamps,
});

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    type: text("type").$type<"personal" | "business" | "project" | "system">().notNull().default("business"),
    description: text("description").notNull().default(""),
    color: text("color").notNull().default("#6366f1"),
    icon: text("icon").notNull().default("briefcase"),
    // brand voice / style guide the assistant uses when writing for this workspace
    brandVoice: text("brand_voice", { mode: "json" }).$type<{
      tone?: string;
      formality?: "casual" | "neutral" | "formal";
      language?: string;
      doList?: string[];
      dontList?: string[];
      signature?: string;
    }>().notNull().default(sql`'{}'`),
    settings: text("settings", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
    isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (t) => ({
    ownerIdx: index("workspaces_owner_idx").on(t.ownerId),
    slugIdx: uniqueIndex("workspaces_owner_slug_idx").on(t.ownerId, t.slug),
  }),
);

export const workspaceMembers = sqliteTable(
  "workspace_members",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<"owner" | "admin" | "member" | "viewer">().notNull().default("member"),
    ...timestamps,
  },
  (t) => ({
    uniq: uniqueIndex("workspace_members_uniq").on(t.workspaceId, t.userId),
    userIdx: index("workspace_members_user_idx").on(t.userId),
  }),
);

/* ───────────────────────────── agents ───────────────────────────── */

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(), // orchestrator | email | calendar | documents | social | research | task | browser | business_advisor | qa_safety
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").$type<"core" | "channel" | "utility" | "safety">().notNull().default("utility"),
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
});

export const agentSettings = sqliteTable(
  "agent_settings",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }), // null = user-global default
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    agentKey: text("agent_key").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    // provider/model override; null falls back to ModelRouter policy
    provider: text("provider").$type<"anthropic" | "openai" | "google" | null>(),
    model: text("model"),
    // default risk posture for actions this agent proposes
    autonomy: text("autonomy").$type<"suggest_only" | "act_on_green" | "act_on_yellow">().notNull().default("act_on_green"),
    instructions: text("instructions").notNull().default(""),
    config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
    ...timestamps,
  },
  (t) => ({
    uniq: uniqueIndex("agent_settings_uniq").on(t.userId, t.workspaceId, t.agentKey),
  }),
);

/* ───────────────────────────── integrations ───────────────────────────── */

export const integrations = sqliteTable(
  "integrations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }), // null = account-level
    provider: text("provider").notNull(), // gmail | google_calendar | google_drive | instagram | ...
    displayName: text("display_name").notNull().default(""),
    status: text("status").$type<"not_connected" | "connecting" | "connected" | "error" | "coming_soon">().notNull().default("not_connected"),
    // capability keys this connector advertises (read_email, send_email, ...)
    capabilities: text("capabilities", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    accountLabel: text("account_label"), // e.g. connected email address / handle
    lastSyncedAt: text("last_synced_at"),
    lastError: text("last_error"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
    ...timestamps,
  },
  (t) => ({
    uniq: uniqueIndex("integrations_uniq").on(t.userId, t.workspaceId, t.provider),
  }),
);

// Secrets are stored separately so they are never selected by accident.
// In Supabase this table is service-role only (no RLS grant to authenticated).
export const integrationCredentials = sqliteTable("integration_credentials", {
  id: text("id").primaryKey(),
  integrationId: text("integration_id").notNull().references(() => integrations.id, { onDelete: "cascade" }),
  // encrypted-at-rest blob; the app encrypts before write (see lib/crypto)
  ciphertext: text("ciphertext").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  ...timestamps,
});

/* ───────────────────────────── contacts ───────────────────────────── */

export const contacts = sqliteTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    company: text("company"),
    role: text("role"),
    email: text("email"),
    phone: text("phone"),
    socialHandles: text("social_handles", { mode: "json" }).$type<Record<string, string>>().notNull().default(sql`'{}'`),
    relationshipType: text("relationship_type").$type<
      "client" | "lead" | "supplier" | "partner" | "family" | "professional" | "other"
    >().notNull().default("other"),
    importance: text("importance").$type<"low" | "normal" | "high" | "vip">().notNull().default("normal"),
    communicationStyle: text("communication_style").notNull().default(""),
    notes: text("notes").notNull().default(""),
    openThreads: text("open_threads", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    lastInteractionAt: text("last_interaction_at"),
    ...timestamps,
  },
  (t) => ({
    wsIdx: index("contacts_ws_idx").on(t.workspaceId),
    emailIdx: index("contacts_email_idx").on(t.email),
  }),
);

/* ───────────────────────────── email ───────────────────────────── */

export const senderRules = sqliteTable(
  "sender_rules",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    sender: text("sender").notNull(), // email address or domain
    category: text("category").$type<
      "personal" | "business" | "service" | "invoice" | "system" | "newsletter" | "spam" | "lead"
    >().notNull().default("business"),
    priority: text("priority").$type<"low" | "normal" | "high" | "urgent">().notNull().default("normal"),
    autoArchive: integer("auto_archive", { mode: "boolean" }).notNull().default(false),
    autoReplyAllowed: integer("auto_reply_allowed", { mode: "boolean" }).notNull().default(false),
    approvalRequired: integer("approval_required", { mode: "boolean" }).notNull().default(true),
    notes: text("notes").notNull().default(""),
    ...timestamps,
  },
  (t) => ({
    uniq: uniqueIndex("sender_rules_uniq").on(t.userId, t.sender),
  }),
);

export const emails = sqliteTable(
  "emails",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    integrationId: text("integration_id").references(() => integrations.id, { onDelete: "set null" }),
    externalId: text("external_id"), // Gmail message id
    threadId: text("thread_id"),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    toAddresses: text("to_addresses", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    subject: text("subject").notNull().default(""),
    snippet: text("snippet").notNull().default(""),
    bodyText: text("body_text").notNull().default(""),
    receivedAt: text("received_at").notNull().default(now),
    category: text("category").$type<
      "personal" | "business" | "service" | "invoice" | "system" | "newsletter" | "spam" | "lead" | "unknown"
    >().notNull().default("unknown"),
    priority: text("priority").$type<"low" | "normal" | "high" | "urgent">().notNull().default("normal"),
    isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
    replyRequired: integer("reply_required", { mode: "boolean" }).notNull().default(false),
    status: text("status").$type<"inbox" | "drafted" | "waiting_approval" | "sent" | "archived">().notNull().default("inbox"),
    aiSummary: text("ai_summary"),
    draftReply: text("draft_reply"),
    source: text("source").$type<"gmail" | "seed" | "manual">().notNull().default("manual"),
    ...timestamps,
  },
  (t) => ({
    userIdx: index("emails_user_idx").on(t.userId),
    statusIdx: index("emails_status_idx").on(t.status),
  }),
);

/* ───────────────────────────── social / messaging ───────────────────────────── */

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    integrationId: text("integration_id").references(() => integrations.id, { onDelete: "set null" }),
    channel: text("channel").$type<"instagram" | "facebook" | "tiktok" | "whatsapp" | "telegram">().notNull(),
    kind: text("kind").$type<"dm" | "comment" | "mention">().notNull().default("dm"),
    externalId: text("external_id"),
    authorHandle: text("author_handle").notNull(),
    authorName: text("author_name"),
    text: text("text").notNull().default(""),
    receivedAt: text("received_at").notNull().default(now),
    classification: text("classification").$type<
      "lead" | "question" | "complaint" | "spam" | "praise" | "needs_human" | "other"
    >().notNull().default("other"),
    sentiment: text("sentiment").$type<"positive" | "neutral" | "negative">().notNull().default("neutral"),
    priority: text("priority").$type<"low" | "normal" | "high" | "urgent">().notNull().default("normal"),
    status: text("status").$type<"new" | "drafted" | "waiting_approval" | "replied" | "ignored">().notNull().default("new"),
    draftReply: text("draft_reply"),
    source: text("source").$type<"live" | "seed" | "manual">().notNull().default("manual"),
    ...timestamps,
  },
  (t) => ({
    userIdx: index("messages_user_idx").on(t.userId),
    statusIdx: index("messages_status_idx").on(t.status),
  }),
);

/* ───────────────────────────── documents ───────────────────────────── */

export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: text("kind").$type<"pdf" | "docx" | "xlsx" | "csv" | "image" | "text" | "other">().notNull().default("other"),
    mimeType: text("mime_type").notNull().default("application/octet-stream"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    storagePath: text("storage_path"), // local path or bucket key
    extractedText: text("extracted_text").notNull().default(""),
    summary: text("summary"),
    // structured extraction: action items, dates, financial figures, parties
    analysis: text("analysis", { mode: "json" }).$type<{
      actionItems?: string[];
      dates?: { label: string; date: string }[];
      financials?: { label: string; amount: string }[];
      parties?: string[];
      anomalies?: string[];
    }>().notNull().default(sql`'{}'`),
    status: text("status").$type<"uploaded" | "processing" | "ready" | "failed">().notNull().default("uploaded"),
    ...timestamps,
  },
  (t) => ({ wsIdx: index("documents_ws_idx").on(t.workspaceId) }),
);

// Vector-ready: embedding stored as JSON float array locally; pgvector in Supabase.
export const documentChunks = sqliteTable(
  "document_chunks",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull().default(0),
    content: text("content").notNull(),
    embedding: text("embedding", { mode: "json" }).$type<number[] | null>(),
    tokens: integer("tokens").notNull().default(0),
    ...timestamps,
  },
  (t) => ({ docIdx: index("document_chunks_doc_idx").on(t.documentId) }),
);

/* ───────────────────────────── goals & tasks ───────────────────────────── */

export const goals = sqliteTable(
  "goals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    metric: text("metric"), // e.g. "monthly sales (ILS)"
    target: text("target"),
    currentValue: text("current_value"),
    deadline: text("deadline"),
    status: text("status").$type<"active" | "paused" | "achieved" | "abandoned">().notNull().default("active"),
    progress: integer("progress").notNull().default(0), // 0..100
    strategy: text("strategy", { mode: "json" }).$type<{
      nextActions?: string[];
      experiments?: { hypothesis: string; result?: string }[];
      whatWorked?: string[];
      whatDidnt?: string[];
    }>().notNull().default(sql`'{}'`),
    ...timestamps,
  },
  (t) => ({ wsIdx: index("goals_ws_idx").on(t.workspaceId) }),
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").$type<
      "inbox" | "planned" | "in_progress" | "waiting" | "waiting_approval" | "completed" | "failed"
    >().notNull().default("inbox"),
    priority: text("priority").$type<"low" | "normal" | "high" | "urgent">().notNull().default("normal"),
    dueDate: text("due_date"),
    createdBy: text("created_by").$type<"user" | "assistant" | "system">().notNull().default("user"),
    assignedTo: text("assigned_to").$type<"user" | "assistant">().notNull().default("assistant"),
    source: text("source").notNull().default("manual"), // manual | assistant | email:<id> | document:<id> | message:<id>
    parentTaskId: text("parent_task_id"),
    goalId: text("goal_id").references(() => goals.id, { onDelete: "set null" }),
    followUpAt: text("follow_up_at"),
    requiresApproval: integer("requires_approval", { mode: "boolean" }).notNull().default(false),
    // ordered list of concrete steps the orchestrator planned
    plan: text("plan", { mode: "json" }).$type<
      { step: string; status: "pending" | "done" | "blocked"; note?: string }[]
    >().notNull().default(sql`'[]'`),
    outcome: text("outcome"), // free-text: what "done" means / result achieved
    completedAt: text("completed_at"),
    ...timestamps,
  },
  (t) => ({
    wsIdx: index("tasks_ws_idx").on(t.workspaceId),
    statusIdx: index("tasks_status_idx").on(t.status),
    followUpIdx: index("tasks_followup_idx").on(t.followUpAt),
  }),
);

/* ───────────────────────────── reminders ───────────────────────────── */

export const reminders = sqliteTable(
  "reminders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    kind: text("kind").$type<"one_time" | "recurring" | "follow_up" | "condition" | "deadline" | "pre_event">().notNull().default("one_time"),
    dueAt: text("due_at").notNull(),
    timezone: text("timezone").notNull().default("Asia/Jerusalem"),
    recurrence: text("recurrence"), // RRULE-ish string or "daily"/"weekly"/"weekdays"
    condition: text("condition"), // human-readable condition for condition-based reminders
    linkedTaskId: text("linked_task_id").references(() => tasks.id, { onDelete: "set null" }),
    linkedContactId: text("linked_contact_id").references(() => contacts.id, { onDelete: "set null" }),
    status: text("status").$type<"scheduled" | "fired" | "snoozed" | "done" | "cancelled">().notNull().default("scheduled"),
    lastFiredAt: text("last_fired_at"),
    ...timestamps,
  },
  (t) => ({
    dueIdx: index("reminders_due_idx").on(t.dueAt),
    statusIdx: index("reminders_status_idx").on(t.status),
  }),
);

/* ───────────────────────────── approvals ───────────────────────────── */

export const approvals = sqliteTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    // what happened that triggered this
    context: text("context").notNull().default(""),
    // the proposed action, machine-readable so it can be executed on approve
    actionType: text("action_type").notNull(), // send_email | reply_message | post_social | update_event | update_crm | archive_email | browser_action | ...
    actionPayload: text("action_payload", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
    targetSystem: text("target_system").notNull().default(""), // gmail | instagram | google_calendar | ...
    riskLevel: text("risk_level").$type<"green" | "yellow" | "red">().notNull().default("yellow"),
    reason: text("reason").notNull().default(""), // why approval is required
    preview: text("preview").notNull().default(""), // human-readable preview / draft content
    proposedBy: text("proposed_by").notNull().default("orchestrator"), // agent key
    // short human code for approving from WhatsApp ("אשר A7"); unique among pending
    shortCode: text("short_code"),
    status: text("status").$type<"pending" | "approved" | "edited_approved" | "rejected" | "expired" | "executed" | "failed">().notNull().default("pending"),
    decidedBy: text("decided_by"),
    decidedAt: text("decided_at"),
    editedPayload: text("edited_payload", { mode: "json" }).$type<Record<string, unknown> | null>(),
    executionResult: text("execution_result", { mode: "json" }).$type<Record<string, unknown> | null>(),
    relatedTaskId: text("related_task_id").references(() => tasks.id, { onDelete: "set null" }),
    relatedConversationId: text("related_conversation_id"),
    expiresAt: text("expires_at"),
    ...timestamps,
  },
  (t) => ({
    statusIdx: index("approvals_status_idx").on(t.status),
    userIdx: index("approvals_user_idx").on(t.userId),
  }),
);

/* ───────────────────────────── memory ───────────────────────────── */

export const memories = sqliteTable(
  "memories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }), // null = applies to all
    type: text("type").$type<"permanent" | "working" | "knowledge" | "activity">().notNull().default("permanent"),
    subject: text("subject").notNull(),
    content: text("content").notNull(),
    // when type=permanent and this encodes a rule the approval engine consults
    ruleKind: text("rule_kind").$type<
      "always_require_approval" | "never_delete_from" | "auto_reply_allowed" | "writing_style" | "do_not" | "custom" | null
    >(),
    ruleTarget: text("rule_target"), // e.g. sender/domain/contact/action-type the rule applies to
    importance: text("importance").$type<"low" | "normal" | "high" | "critical">().notNull().default("normal"),
    source: text("source").notNull().default("user"), // user | assistant | document:<id> | conversation:<id>
    confidence: integer("confidence").notNull().default(100), // 0..100
    expiresAt: text("expires_at"), // working memory can expire
    ...timestamps,
  },
  (t) => ({
    typeIdx: index("memories_type_idx").on(t.type),
    userIdx: index("memories_user_idx").on(t.userId),
  }),
);

/* ───────────────────────────── activity log ───────────────────────────── */

export const activityLogs = sqliteTable(
  "activity_logs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    agent: text("agent").notNull().default("orchestrator"),
    action: text("action").notNull(), // short verb phrase
    tool: text("tool"), // tool / system used
    target: text("target"), // what it acted on
    riskLevel: text("risk_level").$type<"green" | "yellow" | "red" | "none">().notNull().default("none"),
    approvalStatus: text("approval_status").$type<
      "not_required" | "pending" | "approved" | "rejected" | "auto"
    >().notNull().default("not_required"),
    approvedBy: text("approved_by"),
    result: text("result").$type<"success" | "failure" | "info" | "waiting">().notNull().default("info"),
    error: text("error"),
    autoExecuted: integer("auto_executed", { mode: "boolean" }).notNull().default(true),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => ({
    userIdx: index("activity_logs_user_idx").on(t.userId),
    createdIdx: index("activity_logs_created_idx").on(t.createdAt),
  }),
);

/* ───────────────────────────── conversations ───────────────────────────── */

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    title: text("title").notNull().default("שיחה חדשה"),
    lastMessageAt: text("last_message_at").notNull().default(now),
    ...timestamps,
  },
  (t) => ({ userIdx: index("conversations_user_idx").on(t.userId) }),
);

export const conversationMessages = sqliteTable(
  "conversation_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant" | "system" | "tool">().notNull(),
    content: text("content").notNull().default(""),
    // orchestrator trace: intent, workspace, agents/tools invoked, approvals raised
    trace: text("trace", { mode: "json" }).$type<{
      intent?: string;
      workspaceGuess?: string;
      agents?: string[];
      toolCalls?: { tool: string; input: unknown; output?: unknown }[];
      approvalIds?: string[];
      taskIds?: string[];
      reminderIds?: string[];
      provider?: string;
      model?: string;
      mock?: boolean;
    }>(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => ({ convIdx: index("conversation_messages_conv_idx").on(t.conversationId) }),
);

/* ───────────────────────────── automation rules & notifications ───────────────────────────── */

export const automationRules = sqliteTable("automation_rules", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // trigger: event key (email.received, message.received, task.overdue, reminder.due, schedule.cron)
  trigger: text("trigger").notNull(),
  triggerConfig: text("trigger_config", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
  // condition: JSON-logic-ish predicate evaluated by the automation engine
  condition: text("condition", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
  // action: same shape as approvals.actionType + payload
  actionType: text("action_type").notNull(),
  actionPayload: text("action_payload", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
  // even a matching rule can still be forced through approval
  forceApproval: integer("force_approval", { mode: "boolean" }).notNull().default(false),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastRunAt: text("last_run_at"),
  runCount: integer("run_count").notNull().default(0),
  ...timestamps,
});

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    kind: text("kind").$type<
      "approval_pending" | "reminder" | "brief" | "proactive" | "task_overdue" | "integration_error" | "info"
    >().notNull().default("info"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    href: text("href"),
    priority: text("priority").$type<"low" | "normal" | "high" | "urgent">().notNull().default("normal"),
    readAt: text("read_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => ({ userIdx: index("notifications_user_idx").on(t.userId) }),
);

/* ───────────────────────────── auth (dev driver) ───────────────────────────── */

// Only used when AUTH_DRIVER=dev. Supabase Auth replaces this entirely.
export const devSessions = sqliteTable("dev_sessions", {
  token: text("token").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull().default(now),
  expiresAt: text("expires_at").notNull(),
});

export const schema = {
  users,
  workspaces,
  workspaceMembers,
  agents,
  agentSettings,
  integrations,
  integrationCredentials,
  contacts,
  senderRules,
  emails,
  messages,
  documents,
  documentChunks,
  goals,
  tasks,
  reminders,
  approvals,
  memories,
  activityLogs,
  conversations,
  conversationMessages,
  automationRules,
  notifications,
  devSessions,
};
