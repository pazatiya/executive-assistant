-- ═══════════════════════════════════════════════════════════════════
-- Row Level Security. Every row is owned by a user; workspace-scoped tables
-- are additionally reachable by workspace members. The service role (used by
-- the Next.js server for privileged work like the reminder engine) bypasses RLS.
-- ═══════════════════════════════════════════════════════════════════

-- helper: is the current user a member of / owner of this workspace?
create or replace function public.is_workspace_member(ws uuid) returns boolean as $$
  select exists (
    select 1 from public.workspaces w where w.id = ws and w.owner_id = auth.uid()
    union
    select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$ language sql stable security definer;

-- enable RLS everywhere
do $$
declare t text;
begin
  foreach t in array array[
    'users','workspaces','workspace_members','agent_settings','integrations',
    'integration_credentials','contacts','sender_rules','emails','messages','documents',
    'document_chunks','goals','tasks','reminders','approvals','memories','activity_logs',
    'conversations','conversation_messages','automation_rules','notifications'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- agents table is a public read-only catalog
alter table public.agents enable row level security;
drop policy if exists agents_read on public.agents;
create policy agents_read on public.agents for select to authenticated using (true);

-- users: can see & update own row
drop policy if exists users_self on public.users;
create policy users_self on public.users
  for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- workspaces: owner or member reads; owner writes
drop policy if exists workspaces_read on public.workspaces;
create policy workspaces_read on public.workspaces
  for select to authenticated using (owner_id = auth.uid() or public.is_workspace_member(id));
drop policy if exists workspaces_write on public.workspaces;
create policy workspaces_write on public.workspaces
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists wm_read on public.workspace_members;
create policy wm_read on public.workspace_members
  for select to authenticated using (user_id = auth.uid() or public.is_workspace_member(workspace_id));
drop policy if exists wm_write on public.workspace_members;
create policy wm_write on public.workspace_members
  for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

-- generic "owned by user_id" tables
do $$
declare t text;
begin
  foreach t in array array[
    'agent_settings','integrations','contacts','sender_rules','emails','messages',
    'documents','goals','tasks','reminders','approvals','memories','activity_logs',
    'conversations','automation_rules','notifications'
  ] loop
    execute format('drop policy if exists %1$s_owner on public.%1$s;', t);
    execute format($f$
      create policy %1$s_owner on public.%1$s
      for all to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
    $f$, t);
  end loop;
end $$;

-- child tables keyed by parent, not user_id
drop policy if exists document_chunks_scope on public.document_chunks;
create policy document_chunks_scope on public.document_chunks
  for all to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id and d.user_id = auth.uid()))
  with check (exists (select 1 from public.documents d where d.id = document_id and d.user_id = auth.uid()));

drop policy if exists conv_messages_scope on public.conversation_messages;
create policy conv_messages_scope on public.conversation_messages
  for all to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()));

-- integration_credentials: NO policy for `authenticated` → only service_role can touch it.
revoke all on public.integration_credentials from authenticated;
