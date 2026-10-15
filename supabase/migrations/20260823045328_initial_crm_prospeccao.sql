create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid references auth.users(id) on delete set null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create or replace function private.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspaces w
    where w.id = target_workspace_id
      and w.owner_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = (select auth.uid())
  );
$$;

create or replace function private.can_manage_workspace(target_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspaces w
    where w.id = target_workspace_id
      and w.owner_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = (select auth.uid())
      and wm.role in ('owner', 'admin')
  );
$$;

revoke all on function private.is_workspace_member(uuid) from public, anon;
revoke all on function private.can_manage_workspace(uuid) from public, anon;
grant execute on function private.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function private.can_manage_workspace(uuid) to authenticated, service_role;

create table public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_type text not null check (source_type in ('google_maps', 'website', 'social', 'csv', 'manual', 'form', 'other')),
  name text not null,
  source_url text,
  query jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_id uuid references public.lead_sources(id) on delete set null,
  name text not null,
  normalized_name text,
  legal_name text,
  website_url text,
  domain text,
  main_phone text,
  main_email text,
  address_line text,
  city text,
  state text,
  country text not null default 'BR',
  category text,
  status text not null default 'new' check (
    status in (
      'new',
      'researching',
      'qualified',
      'rejected',
      'ready_for_outreach',
      'contacted',
      'responded',
      'meeting_scheduled',
      'won',
      'lost'
    )
  ),
  score integer check (score is null or (score >= 0 and score <= 100)),
  confidence_score numeric(4,3) check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  fit_summary text,
  pain_points jsonb not null default '[]'::jsonb,
  recommended_offer text,
  metadata jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  full_name text,
  role_title text,
  email text,
  phone text,
  linkedin_url text,
  channel_preference text check (channel_preference is null or channel_preference in ('email', 'whatsapp', 'phone', 'linkedin', 'other')),
  source_url text,
  confidence_score numeric(4,3) check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  source_id uuid references public.lead_sources(id) on delete set null,
  evidence_type text not null default 'web_page',
  source_url text,
  title text,
  extracted_text text,
  raw_data jsonb not null default '{}'::jsonb,
  confidence_score numeric(4,3) check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task_type text not null check (
    task_type in (
      'search_companies',
      'analyze_company',
      'audit_company',
      'draft_outreach',
      'follow_up',
      'human_review',
      'sync_memory'
    )
  ),
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed', 'cancelled')),
  priority integer not null default 50 check (priority >= 0 and priority <= 100),
  company_id uuid references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  attempts integer not null default 0,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task_id uuid references public.agent_tasks(id) on delete set null,
  agent_name text not null,
  model_provider text check (model_provider is null or model_provider in ('openai', 'anthropic', 'manual', 'other')),
  model_name text,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error_message text,
  prompt_tokens integer,
  completion_tokens integer,
  estimated_cost numeric(12,6),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.outreach_sequences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  channel text not null check (channel in ('email', 'whatsapp', 'phone', 'linkedin', 'other')),
  max_steps integer not null default 3 check (max_steps >= 1 and max_steps <= 10),
  steps jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.outreach_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  sequence_id uuid references public.outreach_sequences(id) on delete set null,
  channel text not null check (channel in ('email', 'whatsapp', 'phone', 'linkedin', 'other')),
  step_number integer not null default 1 check (step_number >= 1),
  status text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'replied', 'failed', 'cancelled')),
  subject text,
  body text not null,
  personalization_used jsonb not null default '[]'::jsonb,
  generated_by_run_id uuid references public.agent_runs(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  message_id uuid references public.outreach_messages(id) on delete set null,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled', 'skipped')),
  due_at timestamptz not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  activity_type text not null check (
    activity_type in (
      'note',
      'call',
      'email',
      'whatsapp',
      'linkedin',
      'meeting',
      'status_change',
      'human_review',
      'system'
    )
  ),
  title text not null,
  body text,
  metadata jsonb not null default '{}'::jsonb,
  happened_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.knowledge_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_type text not null check (entity_type in ('workspace', 'company', 'contact', 'campaign', 'learning', 'other')),
  entity_id uuid,
  vault_path text not null,
  title text not null,
  checksum text,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, vault_path)
);

create index workspace_members_user_idx on public.workspace_members(user_id);
create index lead_sources_workspace_idx on public.lead_sources(workspace_id);
create index companies_workspace_status_idx on public.companies(workspace_id, status);
create index companies_workspace_score_idx on public.companies(workspace_id, score desc nulls last);
create unique index companies_workspace_domain_uidx on public.companies(workspace_id, domain) where domain is not null and domain <> '';
create unique index companies_workspace_name_location_uidx on public.companies(workspace_id, normalized_name, city, state);
create index contacts_workspace_company_idx on public.contacts(workspace_id, company_id);
create unique index contacts_workspace_email_uidx on public.contacts(workspace_id, lower(email)) where email is not null and email <> '';
create index evidence_company_idx on public.evidence_items(workspace_id, company_id);
create index agent_tasks_queue_idx on public.agent_tasks(workspace_id, status, run_after, priority desc);
create index agent_runs_task_idx on public.agent_runs(task_id);
create index outreach_messages_company_idx on public.outreach_messages(workspace_id, company_id);
create index follow_ups_due_idx on public.follow_ups(workspace_id, status, due_at);
create index activities_company_idx on public.activities(workspace_id, company_id, happened_at desc);
create index knowledge_notes_entity_idx on public.knowledge_notes(workspace_id, entity_type, entity_id);

create trigger set_workspaces_updated_at before update on public.workspaces for each row execute function public.set_updated_at();
create trigger set_lead_sources_updated_at before update on public.lead_sources for each row execute function public.set_updated_at();
create trigger set_companies_updated_at before update on public.companies for each row execute function public.set_updated_at();
create trigger set_contacts_updated_at before update on public.contacts for each row execute function public.set_updated_at();
create trigger set_agent_tasks_updated_at before update on public.agent_tasks for each row execute function public.set_updated_at();
create trigger set_outreach_sequences_updated_at before update on public.outreach_sequences for each row execute function public.set_updated_at();
create trigger set_outreach_messages_updated_at before update on public.outreach_messages for each row execute function public.set_updated_at();
create trigger set_follow_ups_updated_at before update on public.follow_ups for each row execute function public.set_updated_at();
create trigger set_knowledge_notes_updated_at before update on public.knowledge_notes for each row execute function public.set_updated_at();

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.lead_sources enable row level security;
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.evidence_items enable row level security;
alter table public.agent_tasks enable row level security;
alter table public.agent_runs enable row level security;
alter table public.outreach_sequences enable row level security;
alter table public.outreach_messages enable row level security;
alter table public.follow_ups enable row level security;
alter table public.activities enable row level security;
alter table public.knowledge_notes enable row level security;

revoke all on table public.workspaces from anon, authenticated;
revoke all on table public.workspace_members from anon, authenticated;
revoke all on table public.lead_sources from anon, authenticated;
revoke all on table public.companies from anon, authenticated;
revoke all on table public.contacts from anon, authenticated;
revoke all on table public.evidence_items from anon, authenticated;
revoke all on table public.agent_tasks from anon, authenticated;
revoke all on table public.agent_runs from anon, authenticated;
revoke all on table public.outreach_sequences from anon, authenticated;
revoke all on table public.outreach_messages from anon, authenticated;
revoke all on table public.follow_ups from anon, authenticated;
revoke all on table public.activities from anon, authenticated;
revoke all on table public.knowledge_notes from anon, authenticated;

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on table public.workspaces to authenticated;
grant select, insert, update, delete on table public.workspace_members to authenticated;
grant select, insert, update, delete on table public.lead_sources to authenticated;
grant select, insert, update, delete on table public.companies to authenticated;
grant select, insert, update, delete on table public.contacts to authenticated;
grant select, insert, update, delete on table public.evidence_items to authenticated;
grant select, insert, update, delete on table public.agent_tasks to authenticated;
grant select, insert, update, delete on table public.agent_runs to authenticated;
grant select, insert, update, delete on table public.outreach_sequences to authenticated;
grant select, insert, update, delete on table public.outreach_messages to authenticated;
grant select, insert, update, delete on table public.follow_ups to authenticated;
grant select, insert, update, delete on table public.activities to authenticated;
grant select, insert, update, delete on table public.knowledge_notes to authenticated;

grant all on table public.workspaces to service_role;
grant all on table public.workspace_members to service_role;
grant all on table public.lead_sources to service_role;
grant all on table public.companies to service_role;
grant all on table public.contacts to service_role;
grant all on table public.evidence_items to service_role;
grant all on table public.agent_tasks to service_role;
grant all on table public.agent_runs to service_role;
grant all on table public.outreach_sequences to service_role;
grant all on table public.outreach_messages to service_role;
grant all on table public.follow_ups to service_role;
grant all on table public.activities to service_role;
grant all on table public.knowledge_notes to service_role;

create policy "members can read workspaces"
on public.workspaces for select
to authenticated
using (private.is_workspace_member(id));

create policy "users can create owned workspaces"
on public.workspaces for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy "owners can update workspaces"
on public.workspaces for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "owners can delete workspaces"
on public.workspaces for delete
to authenticated
using ((select auth.uid()) = owner_id);

create policy "members can read workspace members"
on public.workspace_members for select
to authenticated
using (private.is_workspace_member(workspace_id));

create policy "admins can create workspace members"
on public.workspace_members for insert
to authenticated
with check (private.can_manage_workspace(workspace_id));

create policy "admins can update workspace members"
on public.workspace_members for update
to authenticated
using (private.can_manage_workspace(workspace_id))
with check (private.can_manage_workspace(workspace_id));

create policy "admins can delete workspace members"
on public.workspace_members for delete
to authenticated
using (private.can_manage_workspace(workspace_id));

create policy "members can read lead sources"
on public.lead_sources for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "members can create lead sources"
on public.lead_sources for insert to authenticated
with check (private.is_workspace_member(workspace_id));
create policy "members can update lead sources"
on public.lead_sources for update to authenticated
using (private.is_workspace_member(workspace_id))
with check (private.is_workspace_member(workspace_id));
create policy "members can delete lead sources"
on public.lead_sources for delete to authenticated
using (private.is_workspace_member(workspace_id));

create policy "members can read companies"
on public.companies for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "members can create companies"
on public.companies for insert to authenticated
with check (private.is_workspace_member(workspace_id));
create policy "members can update companies"
on public.companies for update to authenticated
using (private.is_workspace_member(workspace_id))
with check (private.is_workspace_member(workspace_id));
create policy "members can delete companies"
on public.companies for delete to authenticated
using (private.is_workspace_member(workspace_id));

create policy "members can read contacts"
on public.contacts for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "members can create contacts"
on public.contacts for insert to authenticated
with check (private.is_workspace_member(workspace_id));
create policy "members can update contacts"
on public.contacts for update to authenticated
using (private.is_workspace_member(workspace_id))
with check (private.is_workspace_member(workspace_id));
create policy "members can delete contacts"
on public.contacts for delete to authenticated
using (private.is_workspace_member(workspace_id));

create policy "members can read evidence"
on public.evidence_items for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "members can create evidence"
on public.evidence_items for insert to authenticated
with check (private.is_workspace_member(workspace_id));
create policy "members can update evidence"
on public.evidence_items for update to authenticated
using (private.is_workspace_member(workspace_id))
with check (private.is_workspace_member(workspace_id));
create policy "members can delete evidence"
on public.evidence_items for delete to authenticated
using (private.is_workspace_member(workspace_id));

create policy "members can read agent tasks"
on public.agent_tasks for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "members can create agent tasks"
on public.agent_tasks for insert to authenticated
with check (private.is_workspace_member(workspace_id));
create policy "members can update agent tasks"
on public.agent_tasks for update to authenticated
using (private.is_workspace_member(workspace_id))
with check (private.is_workspace_member(workspace_id));
create policy "members can delete agent tasks"
on public.agent_tasks for delete to authenticated
using (private.is_workspace_member(workspace_id));

create policy "members can read agent runs"
on public.agent_runs for select to authenticated
using (private.is_workspace_member(workspace_id));
create policy "members can create agent runs"
on public.agent_runs for insert to authenticated
with check (private.is_workspace_member(workspace_id));
create policy "members can update agent runs"
on public.agent_runs for update to authenticated
using (private.is_workspace_member(workspace_id))
with check (private.is_workspace_member(workspace_id));
create policy "members can delete agent runs"
on public.agent_runs for delete to authenticated
using (private.is_workspace_member(workspace_id));

create policy "members can manage outreach sequences"
on public.outreach_sequences for all to authenticated
using (private.is_workspace_member(workspace_id))
with check (private.is_workspace_member(workspace_id));

create policy "members can manage outreach messages"
on public.outreach_messages for all to authenticated
using (private.is_workspace_member(workspace_id))
with check (private.is_workspace_member(workspace_id));

create policy "members can manage follow ups"
on public.follow_ups for all to authenticated
using (private.is_workspace_member(workspace_id))
with check (private.is_workspace_member(workspace_id));

create policy "members can manage activities"
on public.activities for all to authenticated
using (private.is_workspace_member(workspace_id))
with check (private.is_workspace_member(workspace_id));

create policy "members can manage knowledge notes"
on public.knowledge_notes for all to authenticated
using (private.is_workspace_member(workspace_id))
with check (private.is_workspace_member(workspace_id));

create or replace view public.lead_pipeline_overview
with (security_invoker = true)
as
select
  c.workspace_id,
  c.status,
  count(*) as company_count,
  avg(c.score) as average_score,
  max(c.updated_at) as last_update
from public.companies c
group by c.workspace_id, c.status;

revoke all on table public.lead_pipeline_overview from anon, authenticated;
grant select on table public.lead_pipeline_overview to authenticated;
grant select on table public.lead_pipeline_overview to service_role;
