create table if not exists public.rule_sets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  rules jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  channel text not null default 'whatsapp' check (channel in ('email', 'whatsapp', 'phone', 'linkedin', 'other')),
  subject_template text,
  body_template text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rule_sets_workspace_idx on public.rule_sets(workspace_id, is_active);
create index if not exists message_templates_workspace_idx on public.message_templates(workspace_id, channel, is_active);

create trigger set_rule_sets_updated_at before update on public.rule_sets for each row execute function public.set_updated_at();
create trigger set_message_templates_updated_at before update on public.message_templates for each row execute function public.set_updated_at();

alter table public.rule_sets enable row level security;
alter table public.message_templates enable row level security;

revoke all on table public.rule_sets from anon, authenticated;
revoke all on table public.message_templates from anon, authenticated;

grant select, insert, update, delete on table public.rule_sets to authenticated;
grant select, insert, update, delete on table public.message_templates to authenticated;
grant all on table public.rule_sets to service_role;
grant all on table public.message_templates to service_role;

create policy "members can manage rule sets"
on public.rule_sets for all to authenticated
using (private.is_workspace_member(workspace_id))
with check (private.is_workspace_member(workspace_id));

create policy "members can manage message templates"
on public.message_templates for all to authenticated
using (private.is_workspace_member(workspace_id))
with check (private.is_workspace_member(workspace_id));
