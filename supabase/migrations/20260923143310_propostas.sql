-- I6 fase 1 (23/09): propostas — o que foi oferecido e o que o cliente decidiu.
--
-- Antes so existia a etapa da empresa (contrato fechado / nao fechou). Nao
-- dava para registrar "mandei proposta de site por R$ 1.200, ele recusou por
-- preco, depois aprovou a de agendamento". Agora cada proposta e uma linha,
-- com decisao e motivo, e tudo vira atividade — que e o que a nota da
-- empresa no Obsidian le no "historico comercial".
--
-- A etapa da empresa continua sendo a fonte de verdade do funil. As RPCs
-- abaixo mantem as duas coisas coerentes REUSANDO salvar_acompanhamento_v2
-- (motivo obrigatorio, cancelamento de retornos, nota do Obsidian marcada
-- para sincronizar), em vez de reescrever essas regras aqui.
--
-- Regras:
--   aprovada -> empresa vai para "Contrato fechado". Valor = soma das
--               propostas aprovadas da empresa; servico = lista delas.
--   recusada -> empresa vai para "Nao fechou" SO se nao sobrar outra proposta
--               em aberto nem uma aprovada. Senao, fica registrado e pronto.
--   expirada -> so registra. Proposta sem resposta nao e "nao".

create table if not exists public.propostas (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id   uuid not null,
  servico      text not null check (char_length(btrim(servico)) between 2 and 300),
  valor        numeric(12,2) check (valor is null or (valor >= 0 and valor <= 999999999)),
  status       text not null default 'enviada'
               check (status in ('enviada', 'aprovada', 'recusada', 'expirada')),
  motivo       text check (motivo is null or char_length(motivo) <= 200),
  observacao   text check (observacao is null or char_length(observacao) <= 2000),
  enviada_em   date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  validade     date,
  decidida_em  timestamptz,
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Mesma protecao das mensagens: proposta e empresa no mesmo workspace.
  constraint propostas_company_workspace_fkey
    foreign key (company_id, workspace_id)
    references public.companies(id, workspace_id) on delete cascade,
  constraint propostas_decisao_coerente
    check ((status = 'enviada') = (decidida_em is null)),
  constraint propostas_validade_depois_do_envio
    check (validade is null or validade >= enviada_em)
);

create index if not exists propostas_empresa_idx on public.propostas(company_id, created_at desc);
create index if not exists propostas_workspace_status_idx on public.propostas(workspace_id, status);

drop trigger if exists set_propostas_updated_at on public.propostas;
create trigger set_propostas_updated_at before update on public.propostas
  for each row execute function public.set_updated_at();

-- Proposta nao troca de empresa nem de workspace depois de criada.
create or replace function public.propostas_imutaveis()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.company_id is distinct from old.company_id
     or new.workspace_id is distinct from old.workspace_id then
    raise exception 'A proposta não pode mudar de empresa.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_propostas_imutaveis on public.propostas;
create trigger trg_propostas_imutaveis before update on public.propostas
  for each row execute function public.propostas_imutaveis();
revoke all on function public.propostas_imutaveis() from public, anon, authenticated;

alter table public.propostas enable row level security;

-- Leitura e escrita so para quem e do workspace. Sem DELETE: proposta e
-- historico comercial; errou, marque como expirada.
drop policy if exists "membros leem propostas" on public.propostas;
create policy "membros leem propostas" on public.propostas
  for select to authenticated using (private.is_workspace_member(workspace_id));
drop policy if exists "membros criam propostas" on public.propostas;
create policy "membros criam propostas" on public.propostas
  for insert to authenticated with check (private.is_workspace_member(workspace_id));
drop policy if exists "membros atualizam propostas" on public.propostas;
create policy "membros atualizam propostas" on public.propostas
  for update to authenticated
  using (private.is_workspace_member(workspace_id))
  with check (private.is_workspace_member(workspace_id));

revoke all on table public.propostas from anon;
revoke delete, truncate on table public.propostas from authenticated;
grant select, insert, update on table public.propostas to authenticated;
grant all on table public.propostas to service_role;

-- -----------------------------------------------------------------------------
-- registrar_proposta: "mandei uma proposta".
-- -----------------------------------------------------------------------------
create or replace function public.registrar_proposta(
  p_company    uuid,
  p_servico    text,
  p_valor      numeric default null,
  p_enviada_em date    default null,
  p_validade   date    default null,
  p_observacao text    default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  c   public.companies;
  pid uuid;
  obs text := nullif(btrim(coalesce(p_observacao, '')), '');
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;

  select * into c from public.companies where id = p_company for update;
  if not found then raise exception 'Empresa não encontrada.'; end if;
  if c.opt_out_at is not null then raise exception 'Esta empresa pediu para não ser contatada.'; end if;
  if nullif(btrim(coalesce(p_servico, '')), '') is null then raise exception 'Informe o serviço da proposta.'; end if;

  insert into public.propostas (workspace_id, company_id, servico, valor, enviada_em, validade, observacao)
  values (
    c.workspace_id, c.id, btrim(p_servico), p_valor,
    coalesce(p_enviada_em, (now() at time zone 'America/Sao_Paulo')::date),
    p_validade, obs
  )
  returning id into pid;

  insert into public.activities (workspace_id, company_id, activity_type, title, body, metadata)
  values (
    c.workspace_id, c.id, 'note', 'Proposta enviada',
    btrim(p_servico)
      || case when p_valor is not null then ' — R$ ' || translate(to_char(p_valor, 'FM999,999,990.00'), ',.', '.,') else '' end
      || case when obs is not null then E'\n' || obs else '' end,
    jsonb_build_object('proposta_id', pid, 'proposta', 'enviada', 'valor', p_valor, 'usuario', auth.uid())
  );

  update public.knowledge_notes set sync_status = 'pending'
   where workspace_id = c.workspace_id and entity_id = c.id and entity_type = 'company';

  return pid;
end;
$$;
revoke all on function public.registrar_proposta(uuid, text, numeric, date, date, text) from public, anon;
grant execute on function public.registrar_proposta(uuid, text, numeric, date, date, text) to authenticated;

-- -----------------------------------------------------------------------------
-- decidir_proposta: "o cliente aprovou / recusou / nao respondeu".
-- -----------------------------------------------------------------------------
create or replace function public.decidir_proposta(
  p_proposta uuid,
  p_decisao  text,
  p_motivo   text default null,
  p_data     date default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  p        public.propostas;
  c        public.companies;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  hoje     date := (now() at time zone 'America/Sao_Paulo')::date;
  soma     numeric;
  servicos text;
  abertas  int;
  aprovadas int;
  texto    text;
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  if p_decisao not in ('aprovada', 'recusada', 'expirada') then raise exception 'Decisão inválida.'; end if;
  if p_decisao in ('aprovada', 'recusada') and v_motivo is null then
    raise exception 'Informe o motivo: é o que ensina o que funciona.';
  end if;
  if length(v_motivo) > 200 then raise exception 'Motivo muito longo (até 200 caracteres).'; end if;

  select * into p from public.propostas where id = p_proposta for update;
  if not found then raise exception 'Proposta não encontrada.'; end if;
  if p.status <> 'enviada' then raise exception 'Esta proposta já foi decidida.'; end if;

  select * into c from public.companies where id = p.company_id for update;

  update public.propostas
     set status = p_decisao, motivo = v_motivo, decidida_em = now()
   where id = p.id;

  texto := p.servico
        || case when p.valor is not null then ' — R$ ' || translate(to_char(p.valor, 'FM999,999,990.00'), ',.', '.,') else '' end;

  select count(*) filter (where status = 'enviada'),
         count(*) filter (where status = 'aprovada'),
         sum(valor) filter (where status = 'aprovada'),
         string_agg(servico, ' + ' order by decidida_em) filter (where status = 'aprovada')
    into abertas, aprovadas, soma, servicos
    from public.propostas where company_id = p.company_id;

  if p_decisao = 'aprovada' then
    -- Reusa a regra do funil: contrato fechado com motivo, retornos
    -- cancelados, nota do Obsidian marcada para sincronizar.
    perform public.salvar_acompanhamento_v2(
      c.id, c.updated_at, 'won',
      'Proposta aprovada: ' || texto,
      soma, coalesce(p_data, hoje), left(servicos, 300), null, v_motivo
    );
  elsif p_decisao = 'recusada' and abertas = 0 and aprovadas = 0 and c.status <> 'lost' then
    perform public.salvar_acompanhamento_v2(
      c.id, c.updated_at, 'lost',
      'Proposta recusada: ' || texto,
      null, null, '', null, v_motivo
    );
  else
    insert into public.activities (workspace_id, company_id, activity_type, title, body, metadata)
    values (
      c.workspace_id, c.id, 'note',
      case p_decisao when 'recusada' then 'Proposta recusada' when 'expirada' then 'Proposta sem resposta' else 'Proposta aprovada' end,
      texto || case when v_motivo is not null then E'\nMotivo: ' || v_motivo else '' end,
      jsonb_build_object('proposta_id', p.id, 'proposta', p_decisao, 'motivo', v_motivo, 'usuario', auth.uid())
    );
    update public.knowledge_notes set sync_status = 'pending'
     where workspace_id = c.workspace_id and entity_id = c.id and entity_type = 'company';
  end if;

  return c.workspace_id;
end;
$$;
revoke all on function public.decidir_proposta(uuid, text, text, date) from public, anon;
grant execute on function public.decidir_proposta(uuid, text, text, date) to authenticated;
