-- ═══════════════════════════════════════════════════════════════════
-- Executive Assistant — canonical Postgres schema for Supabase
-- Mirror of src/lib/db/schema.ts (libSQL). Apply with the Supabase CLI:
--   supabase db push        (or paste into the SQL editor)
-- RLS policies are in 0002_rls_policies.sql.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ── identity ──────────────────────────────────────────────────────
-- users.id mirrors auth.users.id (Supabase Auth) when AUTH_DRIVER=supabase.
create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  full_name     text not null default '',
  avatar_url    text,
  timezone      text not null default 'Asia/Jerusalem',
  locale        text not null default 'he',
  preferences   jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.workspaces (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.users(id) on delete cascade,
  name          text not null,
  slug          text not null,
  type          text not null default 'business' check (type in ('personal','business','project','system')),
  description   text not null default '',
  color         text not null default '#6366f1',
  icon          text not null default 'briefcase',
  brand_voice   jsonb not null default '{}',
  settings      jsonb not null default '{}',
  is_archived   boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (owner_id, slug)
);
create index if not exists workspaces_owner_idx on public.workspaces(owner_id);

create table if not exists public.workspace_members (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  role          text not null default 'member' check (role in ('owner','admin','member','viewer')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, user_id)
);

-- ── agents ────────────────────────────────────────────────────────
create table if not exists public.agents (
  id            uuid primary key default gen_random_uuid(),
  key           text unique not null,
  name          text not null,
  description   text not null default '',
  category      text not null default 'utility' check (category in ('core','channel','utility','safety')),
  is_system     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.agent_settings (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  agent_key     text not null,
  enabled       boolean not null default true,
  provider      text check (provider in ('anthropic','openai','google')),
  model         text,
  autonomy      text not null default 'act_on_green' check (autonomy in ('suggest_only','act_on_green','act_on_yellow')),
  instructions  text not null default '',
  config        jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, workspace_id, agent_key)
);

-- ── integrations ──────────────────────────────────────────────────
create table if not exists public.integrations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  provider      text not null,
  display_name  text not null default '',
  status        text not null default 'not_connected'
                check (status in ('not_connected','connecting','connected','error','coming_soon')),
  capabilities  jsonb not null default '[]',
  scopes        jsonb not null default '[]',
  account_label text,
  last_synced_at timestamptz,
  last_error    text,
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, workspace_id, provider)
);

-- Secrets: service-role only. No RLS policy granted to `authenticated`.
create table if not exists public.integration_credentials (
  id             uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations(id) on delete cascade,
  ciphertext     text not null,
  key_version    int not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ── contacts ──────────────────────────────────────────────────────
create table if not exists public.contacts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null,
  company       text,
  role          text,
  email         text,
  phone         text,
  social_handles jsonb not null default '{}',
  relationship_type text not null default 'other'
                check (relationship_type in ('client','lead','supplier','partner','family','professional','other')),
  importance    text not null default 'normal' check (importance in ('low','normal','high','vip')),
  communication_style text not null default '',
  notes         text not null default '',
  open_threads  jsonb not null default '[]',
  tags          jsonb not null default '[]',
  last_interaction_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists contacts_ws_idx on public.contacts(workspace_id);

-- ── email ─────────────────────────────────────────────────────────
create table if not exists public.sender_rules (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  sender        text not null,
  category      text not null default 'business'
                check (category in ('personal','business','service','invoice','system','newsletter','spam','lead')),
  priority      text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  auto_archive  boolean not null default false,
  auto_reply_allowed boolean not null default false,
  approval_required boolean not null default true,
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, sender)
);

create table if not exists public.emails (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  workspace_id  uuid references public.workspaces(id) on delete set null,
  integration_id uuid references public.integrations(id) on delete set null,
  external_id   text,
  thread_id     text,
  from_address  text not null,
  from_name     text,
  to_addresses  jsonb not null default '[]',
  subject       text not null default '',
  snippet       text not null default '',
  body_text     text not null default '',
  received_at   timestamptz not null default now(),
  category      text not null default 'unknown',
  priority      text not null default 'normal',
  is_read       boolean not null default false,
  reply_required boolean not null default false,
  status        text not null default 'inbox' check (status in ('inbox','drafted','waiting_approval','sent','archived')),
  ai_summary    text,
  draft_reply   text,
  source        text not null default 'manual',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists emails_user_idx on public.emails(user_id);

create table if not exists public.messages (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  workspace_id  uuid references public.workspaces(id) on delete set null,
  integration_id uuid references public.integrations(id) on delete set null,
  channel       text not null check (channel in ('instagram','facebook','tiktok','whatsapp','telegram')),
  kind          text not null default 'dm' check (kind in ('dm','comment','mention')),
  external_id   text,
  author_handle text not null,
  author_name   text,
  text          text not null default '',
  received_at   timestamptz not null default now(),
  classification text not null default 'other'
                check (classification in ('lead','question','complaint','spam','praise','needs_human','other')),
  sentiment     text not null default 'neutral' check (sentiment in ('positive','neutral','negative')),
  priority      text not null default 'normal',
  status        text not null default 'new' check (status in ('new','drafted','waiting_approval','replied','ignored')),
  draft_reply   text,
  source        text not null default 'manual',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists messages_user_idx on public.messages(user_id);

-- ── documents ─────────────────────────────────────────────────────
create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  title         text not null,
  kind          text not null default 'other' check (kind in ('pdf','docx','xlsx','csv','image','text','other')),
  mime_type     text not null default 'application/octet-stream',
  size_bytes    bigint not null default 0,
  storage_path  text,
  extracted_text text not null default '',
  summary       text,
  analysis      jsonb not null default '{}',
  status        text not null default 'uploaded' check (status in ('uploaded','processing','ready','failed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.document_chunks (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.documents(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  chunk_index   int not null default 0,
  content       text not null,
  embedding     vector(1536),
  tokens        int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists document_chunks_doc_idx on public.document_chunks(document_id);

-- ── goals & tasks ─────────────────────────────────────────────────
create table if not exists public.goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  title         text not null,
  description   text not null default '',
  metric        text,
  target        text,
  current_value text,
  deadline      timestamptz,
  status        text not null default 'active' check (status in ('active','paused','achieved','abandoned')),
  progress      int not null default 0,
  strategy      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  title         text not null,
  description   text not null default '',
  status        text not null default 'inbox'
                check (status in ('inbox','planned','in_progress','waiting','waiting_approval','completed','failed')),
  priority      text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  due_date      timestamptz,
  created_by    text not null default 'user' check (created_by in ('user','assistant','system')),
  assigned_to   text not null default 'assistant',
  source        text not null default 'manual',
  parent_task_id uuid,
  goal_id       uuid references public.goals(id) on delete set null,
  follow_up_at  timestamptz,
  requires_approval boolean not null default false,
  plan          jsonb not null default '[]',
  outcome       text,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists tasks_ws_idx on public.tasks(workspace_id);
create index if not exists tasks_status_idx on public.tasks(status);

-- ── reminders ─────────────────────────────────────────────────────
create table if not exists public.reminders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  title         text not null,
  description   text not null default '',
  kind          text not null default 'one_time'
                check (kind in ('one_time','recurring','follow_up','condition','deadline','pre_event')),
  due_at        timestamptz not null,
  timezone      text not null default 'Asia/Jerusalem',
  recurrence    text,
  condition     text,
  linked_task_id uuid references public.tasks(id) on delete set null,
  linked_contact_id uuid references public.contacts(id) on delete set null,
  status        text not null default 'scheduled' check (status in ('scheduled','fired','snoozed','done','cancelled')),
  last_fired_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists reminders_due_idx on public.reminders(due_at);

-- ── approvals ─────────────────────────────────────────────────────
create table if not exists public.approvals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  workspace_id  uuid references public.workspaces(id) on delete set null,
  title         text not null,
  context       text not null default '',
  action_type   text not null,
  action_payload jsonb not null default '{}',
  target_system text not null default '',
  risk_level    text not null default 'yellow' check (risk_level in ('green','yellow','red')),
  reason        text not null default '',
  preview       text not null default '',
  proposed_by   text not null default 'orchestrator',
  status        text not null default 'pending'
                check (status in ('pending','approved','edited_approved','rejected','expired','executed','failed')),
  decided_by    text,
  decided_at    timestamptz,
  edited_payload jsonb,
  execution_result jsonb,
  related_task_id uuid references public.tasks(id) on delete set null,
  related_conversation_id uuid,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists approvals_status_idx on public.approvals(status);

-- ── memory ────────────────────────────────────────────────────────
create table if not exists public.memories (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  type          text not null default 'permanent' check (type in ('permanent','working','knowledge','activity')),
  subject       text not null,
  content       text not null,
  rule_kind     text check (rule_kind in
                ('always_require_approval','never_delete_from','auto_reply_allowed','writing_style','do_not','custom')),
  rule_target   text,
  importance    text not null default 'normal' check (importance in ('low','normal','high','critical')),
  source        text not null default 'user',
  confidence    int not null default 100,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists memories_type_idx on public.memories(type);

-- ── activity log ──────────────────────────────────────────────────
create table if not exists public.activity_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  workspace_id  uuid references public.workspaces(id) on delete set null,
  agent         text not null default 'orchestrator',
  action        text not null,
  tool          text,
  target        text,
  risk_level    text not null default 'none' check (risk_level in ('green','yellow','red','none')),
  approval_status text not null default 'not_required'
                check (approval_status in ('not_required','pending','approved','rejected','auto')),
  approved_by   text,
  result        text not null default 'info' check (result in ('success','failure','info','waiting')),
  error         text,
  auto_executed boolean not null default true,
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index if not exists activity_logs_user_idx on public.activity_logs(user_id);
create index if not exists activity_logs_created_idx on public.activity_logs(created_at desc);

-- ── conversations ─────────────────────────────────────────────────
create table if not exists public.conversations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  workspace_id  uuid references public.workspaces(id) on delete set null,
  title         text not null default 'שיחה חדשה',
  last_message_at timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.conversation_messages (
  id            uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role          text not null check (role in ('user','assistant','system','tool')),
  content       text not null default '',
  trace         jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists conversation_messages_conv_idx on public.conversation_messages(conversation_id);

-- ── automation & notifications ────────────────────────────────────
create table if not exists public.automation_rules (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  name          text not null,
  trigger       text not null,
  trigger_config jsonb not null default '{}',
  condition     jsonb not null default '{}',
  action_type   text not null,
  action_payload jsonb not null default '{}',
  force_approval boolean not null default false,
  enabled       boolean not null default true,
  last_run_at   timestamptz,
  run_count     int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  workspace_id  uuid references public.workspaces(id) on delete set null,
  kind          text not null default 'info'
                check (kind in ('approval_pending','reminder','brief','proactive','task_overdue','integration_error','info')),
  title         text not null,
  body          text not null default '',
  href          text,
  priority      text not null default 'normal',
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id);

-- updated_at trigger
create or replace function public.touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array[
    'users','workspaces','workspace_members','agents','agent_settings','integrations',
    'integration_credentials','contacts','sender_rules','emails','messages','documents',
    'goals','tasks','reminders','approvals','memories','conversations','automation_rules'
  ] loop
    execute format('drop trigger if exists touch_%1$s on public.%1$s;', t);
    execute format('create trigger touch_%1$s before update on public.%1$s
                    for each row execute function public.touch_updated_at();', t);
  end loop;
end $$;
