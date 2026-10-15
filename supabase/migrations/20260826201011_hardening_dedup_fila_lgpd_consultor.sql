-- =============================================================================
-- Migracao 03 - Correcoes estruturais
--
-- Resolve os achados G3 (deduplicacao), G4 (fila sem trava atomica),
-- G7 (tarefas presas em running) e a lacuna de LGPD apontada na auditoria.
-- Tambem cria a base do consultor por nicho.
--
-- Segura para rodar em base que ja tem dados: nao apaga linha nenhuma.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Deduplicacao que funciona de verdade
-- -----------------------------------------------------------------------------
-- Problema original: o indice unico (workspace_id, normalized_name, city, state)
-- nao impede duplicata quando city/state sao NULL, porque no PostgreSQL
-- NULL <> NULL. Como a maioria dos estabelecimentos do OpenStreetMap nao tem
-- addr:* preenchido, a mesma empresa reentrava a cada busca.
--
-- Solucao em duas camadas:
--   a) chave natural da fonte (osm_ref), que e estavel e sempre existe;
--   b) indice de reserva com NULLS NOT DISTINCT para quem nao vem do OSM.

alter table public.companies
  add column if not exists source_ref text;

comment on column public.companies.source_ref is
  'Identificador estavel na fonte de origem. Ex: "osm:node/2372224299". '
  'E a chave de deduplicacao primaria - sempre preferir a ela.';

-- Preenche o source_ref das linhas que ja existem, a partir do raw_data guardado
-- pela importacao antiga. Sem isso, leads ja importados continuariam duplicando.
update public.companies c
set source_ref = 'osm:' || (c.metadata ->> 'osm_type') || '/' || (c.metadata ->> 'osm_id')
where c.source_ref is null
  and c.metadata ->> 'osm_type' is not null
  and c.metadata ->> 'osm_id' is not null;

-- Remove duplicatas ja existentes antes de criar o indice unico, senao a
-- criacao falha. Mantem a linha mais antiga (a que tem historico ligado a ela)
-- e move as demais para uma tabela de quarentena, em vez de apagar.
create table if not exists public.companies_duplicadas_arquivadas (
  id uuid primary key,
  workspace_id uuid,
  name text,
  source_ref text,
  arquivada_em timestamptz not null default now(),
  motivo text,
  dados jsonb
);

with ranked as (
  select
    id,
    workspace_id,
    source_ref,
    row_number() over (
      partition by workspace_id, source_ref
      order by created_at asc, id asc
    ) as posicao
  from public.companies
  where source_ref is not null
),
duplicadas as (
  select id from ranked where posicao > 1
)
insert into public.companies_duplicadas_arquivadas (id, workspace_id, name, source_ref, motivo, dados)
select c.id, c.workspace_id, c.name, c.source_ref, 'duplicata por source_ref na migracao 03', to_jsonb(c)
from public.companies c
join duplicadas d on d.id = c.id
on conflict (id) do nothing;

delete from public.companies c
using public.companies_duplicadas_arquivadas a
where c.id = a.id;

-- Toda empresa precisa ter source_ref, inclusive a cadastrada a mao. Quando
-- nao vem da fonte, derivamos um identificador estavel de nome+cidade+estado.
-- Assim existe UMA chave de deduplicacao para tudo, em vez de duas regras
-- concorrentes - e o upsert do PostgREST consegue mirar nela.
--
-- Detalhe que custou caro: o ON CONFLICT nao funciona com indice unico
-- PARCIAL (com clausula WHERE). Por isso o indice abaixo e completo, e a
-- garantia de preenchimento vem do gatilho, nao de um WHERE no indice.
create or replace function public.preencher_source_ref()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source_ref is null or trim(new.source_ref) = '' then
    -- md5 e funcao nativa do PostgreSQL: nao depende de extensao instalada
    -- nem de qual schema ela foi parar. Aqui serve como chave de deduplicacao,
    -- nao como seguranca, entao e adequada.
    new.source_ref := 'local:' || md5(
      coalesce(new.normalized_name, lower(trim(new.name))) || '|' ||
      coalesce(lower(trim(new.city)), '') || '|' ||
      coalesce(lower(trim(new.state)), '')
    );
  end if;

  if new.normalized_name is null then
    new.normalized_name := lower(trim(new.name));
  end if;

  return new;
end;
$$;

drop trigger if exists preencher_source_ref_trg on public.companies;
create trigger preencher_source_ref_trg
  before insert or update of name, city, state, source_ref on public.companies
  for each row execute function public.preencher_source_ref();

-- Preenche as linhas que ja existiam sem source_ref.
update public.companies
set source_ref = 'local:' || md5(
  coalesce(normalized_name, lower(trim(name))) || '|' ||
  coalesce(lower(trim(city)), '') || '|' ||
  coalesce(lower(trim(state)), '')
)
where source_ref is null;

-- Indice COMPLETO (sem WHERE), para o ON CONFLICT do upsert poder usar.
create unique index if not exists companies_workspace_source_ref_uidx
  on public.companies(workspace_id, source_ref);

-- O dominio NAO e identidade e nao pode ser chave unica.
--
-- Duas unidades da mesma rede compartilham o mesmo site; o mesmo
-- estabelecimento pode aparecer duas vezes no OpenStreetMap (um node e um way)
-- com o mesmo website. Com indice unico em (workspace_id, domain), o segundo
-- registro viola a restricao e derruba o LOTE INTEIRO da importacao, porque o
-- ON CONFLICT mira em source_ref e nao trata esse outro conflito.
--
-- A deduplicacao real e o source_ref. O dominio vira indice comum, util para
-- busca e para sinalizar possivel duplicata - nao para bloquear gravacao.
drop index if exists public.companies_workspace_domain_uidx;
create index if not exists companies_workspace_domain_idx
  on public.companies(workspace_id, domain)
  where domain is not null and domain <> '';

-- O antigo indice de nome+cidade+estado deixa de ser unico: essa garantia
-- agora vem embutida no source_ref derivado. Continua existindo como indice
-- comum, porque a busca por nome no painel usa.
drop index if exists public.companies_workspace_name_location_uidx;
create index if not exists companies_workspace_name_location_idx
  on public.companies(workspace_id, normalized_name, city, state);

-- -----------------------------------------------------------------------------
-- 2. Sinais estruturados vindos da fonte
-- -----------------------------------------------------------------------------
-- O OpenStreetMap traz muito mais informacao util do que o projeto original
-- aproveitava: horario de funcionamento, se entrega, se aceita cartao, se tem
-- Instagram, tipo de cozinha. E disso que o consultor tira as recomendacoes.

alter table public.companies
  add column if not exists signals jsonb not null default '{}'::jsonb;

comment on column public.companies.signals is
  'Sinais normalizados extraidos da fonte: has_website, has_phone, has_instagram, '
  'has_opening_hours, has_delivery, accepts_card, etc. Base do motor consultor.';

create index if not exists companies_signals_gin_idx
  on public.companies using gin (signals);

-- -----------------------------------------------------------------------------
-- 3. LGPD - base legal, opt-out e procedencia do dado
-- -----------------------------------------------------------------------------
-- Prospeccao fria com dado pessoal de MEI e pequeno negocio se apoia em
-- legitimo interesse (art. 7, IX). Isso exige poder provar de onde veio o dado,
-- quando veio, e honrar pedido de exclusao. Nada disso existia no schema.

alter table public.companies
  add column if not exists consent_basis text
    not null default 'legitimate_interest'
    check (consent_basis in ('legitimate_interest', 'consent', 'contract', 'unknown')),
  add column if not exists data_source_url text,
  add column if not exists data_collected_at timestamptz,
  add column if not exists opt_out_at timestamptz,
  add column if not exists opt_out_reason text;

alter table public.contacts
  add column if not exists consent_basis text
    not null default 'legitimate_interest'
    check (consent_basis in ('legitimate_interest', 'consent', 'contract', 'unknown')),
  add column if not exists opt_out_at timestamptz,
  add column if not exists opt_out_reason text;

-- Lista de supressao. Ponto importante: marcar opt_out so na empresa nao basta,
-- porque a proxima busca reimporta o mesmo estabelecimento como linha nova e
-- voce volta a abordar quem pediu para nao ser abordado. A supressao precisa
-- viver fora da empresa, indexada pelo contato normalizado.
create table if not exists public.suppression_list (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  match_type text not null check (match_type in ('phone', 'email', 'domain', 'source_ref')),
  match_value text not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (workspace_id, match_type, match_value)
);

create index if not exists suppression_lookup_idx
  on public.suppression_list(workspace_id, match_type, match_value);

comment on table public.suppression_list is
  'Quem pediu para nao ser contatado. Consultada na importacao e antes de gerar '
  'qualquer mensagem. Sobrevive a reimportacao do lead.';

-- Normalizador de telefone para o padrao BR, usado na supressao.
-- Guarda so os digitos e descarta o 55 inicial quando o numero ja e longo,
-- para que "+55 21 99999-8888" e "(21) 99999-8888" batam entre si.
create or replace function public.normalize_phone_br(raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  digitos text;
begin
  if raw is null then
    return null;
  end if;

  digitos := regexp_replace(raw, '[^0-9]', '', 'g');

  -- Remove o prefixo de operadora/interurbano (o "0" de "021 9...").
  digitos := regexp_replace(digitos, '^0+', '');

  -- Remove o codigo do pais so quando sobra numero demais. O guard de
  -- comprimento importa: o DDD 55 (Santa Maria/RS) e legitimo, entao
  -- "55 99999-8888" (11 digitos) NAO pode ser confundido com DDI.
  if length(digitos) > 11 and left(digitos, 2) = '55' then
    digitos := substr(digitos, 3);
  end if;

  -- Fixo tem 10 digitos, celular tem 11. Menos que isso nao e telefone.
  if length(digitos) < 10 or length(digitos) > 11 then
    return null;
  end if;

  return digitos;
end;
$$;

create or replace function public.is_suppressed(
  target_workspace_id uuid,
  phone text,
  email text,
  company_domain text,
  ref text
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.suppression_list s
    where s.workspace_id = target_workspace_id
      and (
        (s.match_type = 'phone'      and s.match_value = public.normalize_phone_br(phone))
        or (s.match_type = 'email'      and s.match_value = lower(trim(email)))
        or (s.match_type = 'domain'     and s.match_value = lower(trim(company_domain)))
        or (s.match_type = 'source_ref' and s.match_value = ref)
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- 4. Fila com trava atomica
-- -----------------------------------------------------------------------------
-- Problema original: selecionar e marcar eram duas chamadas separadas, entao
-- dois cliques (ou tres nos do n8n em paralelo) pegavam a mesma tarefa e o lead
-- recebia duas mensagens. FOR UPDATE SKIP LOCKED resolve numa transacao so.

create or replace function public.claim_next_task(
  target_workspace_id uuid,
  worker_name text default 'unknown',
  allowed_types text[] default null
)
returns public.agent_tasks
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  tarefa public.agent_tasks;
begin
  update public.agent_tasks t
  set
    status = 'running',
    locked_at = now(),
    locked_by = worker_name,
    attempts = t.attempts + 1
  where t.id = (
    select candidata.id
    from public.agent_tasks candidata
    where candidata.workspace_id = target_workspace_id
      and candidata.status = 'pending'
      and candidata.run_after <= now()
      and (allowed_types is null or candidata.task_type = any(allowed_types))
    order by candidata.priority desc, candidata.run_after asc, candidata.created_at asc
    limit 1
    for update skip locked
  )
  returning t.* into tarefa;

  return tarefa;
end;
$$;

comment on function public.claim_next_task(uuid, text, text[]) is
  'Pega e trava a proxima tarefa da fila numa unica transacao. Dois chamadores '
  'simultaneos recebem tarefas diferentes, nunca a mesma.';

-- Fecha a tarefa com sucesso.
create or replace function public.complete_task(
  target_task_id uuid,
  task_result jsonb default '{}'::jsonb
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.agent_tasks
  set status = 'completed',
      result = task_result,
      error_message = null,
      locked_at = null,
      locked_by = null
  where id = target_task_id;
$$;

-- Falha a tarefa: devolve para a fila com espera, ou marca failed no limite.
create or replace function public.fail_task(
  target_task_id uuid,
  message text,
  max_attempts integer default 3,
  retry_delay interval default interval '5 minutes'
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  tentativas integer;
  novo_status text;
begin
  select attempts into tentativas
  from public.agent_tasks
  where id = target_task_id;

  if tentativas is null then
    return 'not_found';
  end if;

  novo_status := case when tentativas >= max_attempts then 'failed' else 'pending' end;

  update public.agent_tasks
  set status = novo_status,
      error_message = message,
      run_after = case when novo_status = 'pending' then now() + retry_delay else run_after end,
      locked_at = null,
      locked_by = null
  where id = target_task_id;

  return novo_status;
end;
$$;

-- Reaper: tarefa que ficou presa em running (funcao morreu no meio, timeout da
-- Edge Function, deploy durante execucao) volta para a fila.
create or replace function public.release_stale_tasks(
  stale_after interval default interval '10 minutes'
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  liberadas integer;
begin
  with soltas as (
    update public.agent_tasks
    set status = case when attempts >= 3 then 'failed' else 'pending' end,
        error_message = coalesce(error_message, 'Liberada pelo reaper: presa em running.'),
        locked_at = null,
        locked_by = null
    where status = 'running'
      and locked_at is not null
      and locked_at < now() - stale_after
    returning 1
  )
  select count(*) into liberadas from soltas;

  return liberadas;
end;
$$;

-- ATENCAO ao "authenticated" nesta lista.
--
-- O Supabase configura um DEFAULT PRIVILEGE que concede EXECUTE ao papel
-- authenticated em TODA funcao nova do schema public. Revogar so de
-- "public, anon" NAO basta: a concessao a authenticated e explicita e
-- sobrevive. Sem revoga-la, estas funcoes SECURITY DEFINER (que rodam como
-- dono e ignoram o RLS) ficam chamaveis por qualquer usuario cadastrado via
-- /rest/v1/rpc/..., com qualquer workspace_id.
--
-- Um PostgreSQL comum nao tem esse default privilege, entao teste local NAO
-- pega esta falha. Quem pega e o "supabase db lint" / painel de advisors.
revoke all on function public.claim_next_task(uuid, text, text[]) from public, anon, authenticated;
revoke all on function public.complete_task(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_task(uuid, text, integer, interval) from public, anon, authenticated;
revoke all on function public.release_stale_tasks(interval) from public, anon, authenticated;
revoke all on function public.preencher_source_ref() from public, anon, authenticated;

-- Estas duas continuam liberadas para authenticated de proposito: sao
-- SECURITY INVOKER (respeitam o RLS) e o painel precisa delas.
revoke all on function public.is_suppressed(uuid, text, text, text, text) from public, anon;
revoke all on function public.normalize_phone_br(text) from public, anon;

grant execute on function public.claim_next_task(uuid, text, text[]) to service_role;
grant execute on function public.complete_task(uuid, jsonb) to service_role;
grant execute on function public.fail_task(uuid, text, integer, interval) to service_role;
grant execute on function public.release_stale_tasks(interval) to service_role;
grant execute on function public.is_suppressed(uuid, text, text, text, text) to authenticated, service_role;
grant execute on function public.normalize_phone_br(text) to authenticated, service_role;

-- Evita fila duplicada: nao adianta ter duas tarefas identicas pendentes para a
-- mesma empresa. Isso acontecia quando a analise rodava duas vezes.
create unique index if not exists agent_tasks_sem_duplicata_pendente_uidx
  on public.agent_tasks(workspace_id, company_id, task_type)
  where status in ('pending', 'running') and company_id is not null;

-- -----------------------------------------------------------------------------
-- 5. Consultor por nicho
-- -----------------------------------------------------------------------------
-- Onde mora o conhecimento de "para esse cliente, proponha isso". Fica em tabela
-- e nao em codigo, justamente para nao repetir o erro do rule_sets que existia
-- no banco mas era ignorado pelo TypeScript.

create table if not exists public.niche_playbooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  slug text not null,
  label text not null,
  -- termos que casam com category, name ou tags do OSM
  match_terms text[] not null default '{}',
  -- prioridade de desempate quando mais de um playbook casa
  weight integer not null default 50 check (weight between 0 and 100),
  -- dores: [{ code, quando (expressao de sinal), texto, gravidade }]
  pains jsonb not null default '[]'::jsonb,
  -- ofertas: [{ code, titulo, pitch, esforco, impacto, quando }]
  offers jsonb not null default '[]'::jsonb,
  -- perguntas de abertura para a primeira mensagem
  opening_questions text[] not null default '{}',
  -- o que evitar falar com esse nicho
  avoid text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create index if not exists niche_playbooks_lookup_idx
  on public.niche_playbooks(workspace_id, is_active, weight desc);

drop trigger if exists set_niche_playbooks_updated_at on public.niche_playbooks;
create trigger set_niche_playbooks_updated_at
  before update on public.niche_playbooks
  for each row execute function public.set_updated_at();

-- O resultado do consultor para cada empresa.
alter table public.companies
  add column if not exists advisor_brief jsonb;

comment on column public.companies.advisor_brief is
  'Recomendacao do consultor: diagnostico, oferta principal, alternativas, '
  'gancho de abertura e nivel de confianca. Regerada a cada analise.';

-- -----------------------------------------------------------------------------
-- 6. Rastreio de custo e resultado
-- -----------------------------------------------------------------------------
-- Sem isso nao da para saber qual mensagem funciona, que e o unico numero que
-- decide se a prospeccao vale a pena.

alter table public.outreach_messages
  add column if not exists template_id uuid references public.message_templates(id) on delete set null,
  add column if not exists replied_at timestamptz,
  add column if not exists reply_sentiment text
    check (reply_sentiment is null or reply_sentiment in ('positive', 'neutral', 'negative'));

create index if not exists outreach_messages_desempenho_idx
  on public.outreach_messages(workspace_id, template_id, status);

-- View de conversao por template e por nicho.
create or replace view public.outreach_performance
with (security_invoker = true)
as
select
  m.workspace_id,
  m.template_id,
  t.name as template_name,
  m.channel,
  c.category,
  count(*) as enviadas,
  count(*) filter (where m.status = 'replied') as respondidas,
  round(
    100.0 * count(*) filter (where m.status = 'replied') / nullif(count(*), 0),
    1
  ) as taxa_resposta_pct,
  count(*) filter (where m.reply_sentiment = 'positive') as respostas_positivas
from public.outreach_messages m
left join public.message_templates t on t.id = m.template_id
left join public.companies c on c.id = m.company_id
where m.status in ('sent', 'replied')
group by m.workspace_id, m.template_id, t.name, m.channel, c.category;

revoke all on table public.outreach_performance from anon, authenticated;
grant select on table public.outreach_performance to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. Memoria do Obsidian
-- -----------------------------------------------------------------------------
-- knowledge_notes ja existia mas nada escrevia nela. Estas colunas dao suporte
-- a sincronizacao incremental via Git: so reescreve nota que realmente mudou.

alter table public.knowledge_notes
  add column if not exists synced_at timestamptz,
  add column if not exists sync_status text
    not null default 'pending'
    check (sync_status in ('pending', 'synced', 'failed', 'conflict')),
  add column if not exists sync_error text,
  add column if not exists body_markdown text;

create index if not exists knowledge_notes_pendentes_idx
  on public.knowledge_notes(workspace_id, sync_status)
  where sync_status in ('pending', 'failed');

-- -----------------------------------------------------------------------------
-- 8. RLS das tabelas novas
-- -----------------------------------------------------------------------------

alter table public.suppression_list enable row level security;
alter table public.niche_playbooks enable row level security;
alter table public.companies_duplicadas_arquivadas enable row level security;

revoke all on table public.suppression_list from anon, authenticated;
revoke all on table public.niche_playbooks from anon, authenticated;
revoke all on table public.companies_duplicadas_arquivadas from anon, authenticated;

grant select, insert, update, delete on table public.suppression_list to authenticated;
grant select, insert, update, delete on table public.niche_playbooks to authenticated;
grant select on table public.companies_duplicadas_arquivadas to authenticated;

grant all on table public.suppression_list to service_role;
grant all on table public.niche_playbooks to service_role;
grant all on table public.companies_duplicadas_arquivadas to service_role;

drop policy if exists "members can manage suppression list" on public.suppression_list;
create policy "members can manage suppression list"
on public.suppression_list for all to authenticated
using (private.is_workspace_member(workspace_id))
with check (private.is_workspace_member(workspace_id));

drop policy if exists "members can manage niche playbooks" on public.niche_playbooks;
create policy "members can manage niche playbooks"
on public.niche_playbooks for all to authenticated
using (private.is_workspace_member(workspace_id))
with check (private.is_workspace_member(workspace_id));

drop policy if exists "members can read archived duplicates" on public.companies_duplicadas_arquivadas;
create policy "members can read archived duplicates"
on public.companies_duplicadas_arquivadas for select to authenticated
using (private.is_workspace_member(workspace_id));
