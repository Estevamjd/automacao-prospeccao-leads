-- Commercial updates are atomic and keep the caller's RLS permissions.
create or replace function public.resumo_comercial(p_workspace uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'total', count(*),
    'prontos', count(*) filter (where status = 'ready_for_outreach' and opt_out_at is null),
    'conversas', count(*) filter (where status in ('contacted','responded','meeting_scheduled')),
    'contratos', count(*) filter (where status = 'won'),
    'valorContratos', coalesce(sum(case when status = 'won' then nullif(metadata->'comercial'->>'valor','')::numeric else 0 end),0),
    'scoreMedio', coalesce(round(avg(score)),0),
    'revisoesHumanas', (select count(*) from public.agent_tasks where workspace_id=p_workspace and task_type='human_review' and status='pending'),
    'tarefasPendentes', (select count(*) from public.agent_tasks where workspace_id=p_workspace and task_type in ('analyze_company','audit_company','draft_outreach') and status='pending'),
    'tarefasComFalha', (select count(*) from public.agent_tasks where workspace_id=p_workspace and status='failed')
  ) from public.companies where workspace_id=p_workspace;
$$;
revoke all on function public.resumo_comercial(uuid) from public, anon;
grant execute on function public.resumo_comercial(uuid) to authenticated;

create or replace function public.salvar_acompanhamento(
  p_company uuid, p_updated_at timestamptz, p_status text,
  p_nota text default '', p_valor numeric default null,
  p_data date default null, p_servico text default '', p_retorno timestamptz default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare c public.companies; novo jsonb;
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  select * into c from public.companies where id=p_company for update;
  if not found then raise exception 'Empresa não encontrada.'; end if;
  if c.updated_at is distinct from p_updated_at then raise exception 'Este cadastro mudou. Atualize a página antes de salvar.'; end if;
  if p_status not in ('new','researching','qualified','ready_for_outreach','contacted','responded','meeting_scheduled','won','lost','rejected') then
    raise exception 'Etapa inválida.';
  end if;
  if c.opt_out_at is not null and p_status <> 'rejected' then raise exception 'Esta empresa pediu para não ser contatada.'; end if;
  if length(p_nota)>5000 or length(p_servico)>300 or p_valor<0 or p_valor>999999999 then raise exception 'Dados inválidos.'; end if;
  if p_status='won' and (p_data is null or nullif(trim(p_servico),'') is null) then raise exception 'Informe o serviço e a data do contrato.'; end if;
  novo := jsonb_build_object('valor',p_valor,'data',p_data,'servico',trim(p_servico));
  if c.status=p_status and coalesce(c.metadata->'comercial','{}')=novo and trim(p_nota)='' and p_retorno is null then return c.workspace_id; end if;
  update public.companies set status=p_status, metadata=metadata || jsonb_build_object('comercial',novo) where id=c.id;
  insert into public.activities(workspace_id,company_id,activity_type,title,body,metadata)
  values(c.workspace_id,c.id,case when c.status<>p_status then 'status_change' else 'note' end,
    case when p_status='won' then 'Contrato fechado' when c.status<>p_status then 'Etapa atualizada' else 'Acompanhamento atualizado' end,
    nullif(trim(p_nota),''),jsonb_build_object('de',c.status,'para',p_status,'comercial',novo,'usuario',auth.uid()));
  if p_status in ('contacted','responded','meeting_scheduled','won','lost') then
    update public.agent_tasks set status='cancelled' where company_id=c.id and workspace_id=c.workspace_id
      and task_type in ('analyze_company','audit_company','draft_outreach','human_review') and status='pending';
  end if;
  if p_status in ('won','lost','rejected') then
    update public.follow_ups set status='cancelled' where company_id=c.id and workspace_id=c.workspace_id and status='scheduled';
  elsif p_retorno is not null then
    update public.follow_ups set status='cancelled' where company_id=c.id and workspace_id=c.workspace_id and status='scheduled';
    insert into public.follow_ups(workspace_id,company_id,due_at,notes) values(c.workspace_id,c.id,p_retorno,nullif(trim(p_nota),''));
  end if;
  update public.knowledge_notes set sync_status='pending' where workspace_id=c.workspace_id and entity_id=c.id and entity_type='company';
  return c.workspace_id;
end;
$$;
revoke all on function public.salvar_acompanhamento(uuid,timestamptz,text,text,numeric,date,text,timestamptz) from public, anon;
grant execute on function public.salvar_acompanhamento(uuid,timestamptz,text,text,numeric,date,text,timestamptz) to authenticated;

-- Background analyses must never move an active negotiation back into prospecting.
create or replace function public.preservar_etapa_comercial()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null and old.status in ('contacted','responded','meeting_scheduled','won','lost') and old.opt_out_at is not distinct from new.opt_out_at then
    new.status := old.status;
  end if;
  return new;
end;
$$;
create trigger preservar_etapa_comercial before update on public.companies
for each row execute function public.preservar_etapa_comercial();

create or replace function public.empresas_para_memoria(p_workspace uuid, p_score integer default 45)
returns setof public.companies language sql stable security invoker set search_path='' as $$
  select c.* from public.companies c
  left join lateral (select n.sync_status, n.metadata, n.synced_at from public.knowledge_notes n
    where n.workspace_id=c.workspace_id and n.entity_type='company' and n.entity_id=c.id
    order by n.updated_at desc limit 1) n on true
  where c.workspace_id=p_workspace
    and (c.score>=p_score or c.status in ('contacted','responded','meeting_scheduled','won','lost') or n.synced_at is not null)
    and (n.synced_at is null or n.sync_status<>'synced' or (n.metadata->>'source_updated_at')::timestamptz is distinct from c.updated_at)
  order by (c.status='won') desc, (n.sync_status='pending') desc nulls last, c.updated_at, c.id limit 25;
$$;
revoke all on function public.empresas_para_memoria(uuid,integer) from public,anon,authenticated;
grant execute on function public.empresas_para_memoria(uuid,integer) to service_role;
