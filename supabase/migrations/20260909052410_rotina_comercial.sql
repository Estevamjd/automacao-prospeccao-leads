alter table public.companies add column if not exists instagram_url text;
alter table public.companies add column if not exists outcome_reason text;
alter table public.companies add column if not exists manual_overrides jsonb not null default '{}';

create or replace function public.salvar_dados_empresa(p_company uuid, p_updated_at timestamptz, p_dados jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare c public.companies; k text; v text; valores jsonb; confirmados jsonb; s jsonb;
begin
  if auth.uid() is null then raise exception 'Faca login.'; end if;
  select * into c from public.companies where id=p_company for update;
  if not found then raise exception 'Empresa nao encontrada.'; end if;
  if c.updated_at is distinct from p_updated_at then raise exception 'Este cadastro mudou. Atualize a pagina antes de salvar.'; end if;
  if p_dados is null or jsonb_typeof(p_dados)<>'object' or p_dados='{}' then raise exception 'Confirme pelo menos um campo.'; end if;
  valores := to_jsonb(c); confirmados := c.manual_overrides;
  for k,v in select key,value from jsonb_each_text(p_dados) loop
    if k not in ('main_phone','main_email','website_url','instagram_url','address_line') then raise exception 'Campo nao permitido.'; end if;
    if jsonb_typeof(p_dados->k) not in ('string','null') then raise exception 'Valor invalido.'; end if;
    v := nullif(trim(v),'');
    if length(v)>500 then raise exception 'Campo muito longo.'; end if;
    if k='main_phone' and v is not null and (v !~ '^[+0-9 ().-]+$' or length(regexp_replace(v,'[^0-9]','','g')) not between 10 and 15) then raise exception 'Telefone invalido.'; end if;
    if k='main_email' and v is not null and v !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'E-mail invalido.'; end if;
    if k in ('website_url','instagram_url') and v is not null and v !~* '^https?://[^[:space:]/]+([/?#][^[:space:]]*)?$' then raise exception 'Use um endereco http ou https valido.'; end if;
    if k='instagram_url' and v is not null and v !~* '^https://(www\.)?instagram\.com/[a-z0-9_.]+/?$' then raise exception 'Informe o link https do perfil no Instagram.'; end if;
    valores := jsonb_set(valores,array[k],coalesce(to_jsonb(v),'null'));
    confirmados := confirmados || jsonb_build_object(k,jsonb_build_object(
      'original',case when confirmados ? k then confirmados->k->'original' else to_jsonb(c)->k end,
      'confirmed_at',clock_timestamp(),'confirmed_by',auth.uid()));
  end loop;
  s := coalesce(c.signals,'{}');
  if p_dados ? 'main_phone' then s := s || jsonb_build_object('has_phone',valores->>'main_phone' is not null); end if;
  if p_dados ? 'main_email' then s := s || jsonb_build_object('has_email',valores->>'main_email' is not null); end if;
  if p_dados ? 'website_url' then s := s || jsonb_build_object('has_website',valores->>'website_url' is not null); end if;
  if p_dados ? 'instagram_url' then s := s || jsonb_build_object('has_instagram',valores->>'instagram_url' is not null); end if;
  s := s || jsonb_build_object('has_any_contact',valores->>'main_phone' is not null or valores->>'main_email' is not null or coalesce((s->>'has_whatsapp')::boolean,false),
    'has_social',coalesce((s->>'has_instagram')::boolean,false) or coalesce((s->>'has_facebook')::boolean,false));
  update public.companies set main_phone=valores->>'main_phone',main_email=valores->>'main_email',
    website_url=valores->>'website_url',instagram_url=valores->>'instagram_url',address_line=valores->>'address_line',
    manual_overrides=confirmados,signals=s,advisor_brief=null,
    status=case when status in ('new','qualified','ready_for_outreach') then 'researching' else status end
    where id=c.id;
  insert into public.activities(workspace_id,company_id,activity_type,title,body,metadata)
    values(c.workspace_id,c.id,'note','Dados confirmados manualmente',
      (select string_agg(key,', ') from jsonb_each(p_dados)),jsonb_build_object('campos',p_dados,'usuario',auth.uid()));
  update public.knowledge_notes set sync_status='pending' where workspace_id=c.workspace_id and entity_id=c.id and entity_type='company';
  if c.opt_out_at is null and c.status in ('new','researching','qualified','ready_for_outreach') then
    perform public.enfileirar_tarefa(c.workspace_id,c.id,'analyze_company',70,jsonb_build_object('manual_update',true));
  end if;
  return c.workspace_id;
end;
$$;
revoke all on function public.salvar_dados_empresa(uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.salvar_dados_empresa(uuid,timestamptz,jsonb) to authenticated;

-- A new endpoint preserves compatibility with existing clients and automations.
create or replace function public.salvar_acompanhamento_v2(
  p_company uuid,p_updated_at timestamptz,p_status text,p_nota text default '',p_valor numeric default null,
  p_data date default null,p_servico text default '',p_retorno timestamptz default null,p_motivo text default null
) returns uuid language plpgsql security invoker set search_path='' as $$
declare w uuid; anterior text; motivo text := nullif(trim(p_motivo),'');
begin
  if auth.uid() is null then raise exception 'Faca login.'; end if;
  if p_status in ('won','lost') and (motivo is null or length(motivo)>200) then raise exception 'Informe o motivo do resultado.'; end if;
  select outcome_reason into anterior from public.companies where id=p_company for update;
  w := public.salvar_acompanhamento(p_company,p_updated_at,p_status,p_nota,p_valor,p_data,p_servico,p_retorno);
  if p_status not in ('won','lost') then motivo := null; end if;
  if anterior is distinct from motivo then
    update public.companies set outcome_reason=motivo where id=p_company;
    insert into public.activities(workspace_id,company_id,activity_type,title,body,metadata)
      values(w,p_company,'note','Motivo do resultado',coalesce(motivo,'Negociacao reaberta'),jsonb_build_object('resultado',p_status,'motivo',motivo));
    update public.knowledge_notes set sync_status='pending' where workspace_id=w and entity_id=p_company and entity_type='company';
  end if;
  return w;
end;
$$;
revoke all on function public.salvar_acompanhamento_v2(uuid,timestamptz,text,text,numeric,date,text,timestamptz,text) from public,anon;
grant execute on function public.salvar_acompanhamento_v2(uuid,timestamptz,text,text,numeric,date,text,timestamptz,text) to authenticated;

create or replace function public.preservar_dados_confirmados()
returns trigger language plpgsql set search_path='' as $$
declare k text; dados jsonb;
begin
  if auth.uid() is null then
    dados := to_jsonb(new);
    for k in select jsonb_object_keys(old.manual_overrides) loop
      if k in ('main_phone','main_email','website_url','instagram_url','address_line') then
        dados := jsonb_set(dados,array[k],to_jsonb(old)->k);
      end if;
    end loop;
    new := jsonb_populate_record(new,dados);
    new.manual_overrides := old.manual_overrides;
    new.outcome_reason := old.outcome_reason;
    if old.metadata ? 'comercial' then new.metadata := new.metadata || jsonb_build_object('comercial',old.metadata->'comercial'); end if;
    if old.manual_overrides ? 'main_phone' then new.signals := new.signals || jsonb_build_object('has_phone',new.main_phone is not null); end if;
    if old.manual_overrides ? 'main_email' then new.signals := new.signals || jsonb_build_object('has_email',new.main_email is not null); end if;
    if old.manual_overrides ? 'website_url' then new.signals := new.signals || jsonb_build_object('has_website',new.website_url is not null); end if;
    if old.manual_overrides ? 'instagram_url' then new.signals := new.signals || jsonb_build_object('has_instagram',new.instagram_url is not null); end if;
    if old.manual_overrides<>'{}' then
      new.signals := new.signals || jsonb_build_object('has_any_contact',new.main_phone is not null or new.main_email is not null or coalesce((new.signals->>'has_whatsapp')::boolean,false),
        'has_social',coalesce((new.signals->>'has_instagram')::boolean,false) or coalesce((new.signals->>'has_facebook')::boolean,false));
    end if;
  end if;
  return new;
end;
$$;
create trigger preservar_dados_confirmados before update on public.companies for each row execute function public.preservar_dados_confirmados();

create or replace function public.resultados_comerciais(p_workspace uuid)
returns table(etapa text,motivo text,segmento text,quantidade bigint) language sql stable security invoker set search_path='' as $$
  select status,coalesce(outcome_reason,'Nao informado'),coalesce(advisor_brief->>'segmento',category,'Sem segmento'),count(*)
  from public.companies where workspace_id=p_workspace and status in ('won','lost') group by 1,2,3 order by 4 desc,1,2,3;
$$;
revoke all on function public.resultados_comerciais(uuid) from public,anon;
grant execute on function public.resultados_comerciais(uuid) to authenticated;
