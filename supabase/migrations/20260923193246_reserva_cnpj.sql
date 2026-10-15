-- I10 (24/09): reserva de empresas do cadastro de CNPJ (dados abertos da Receita).
--
-- POR QUE: 87% das empresas vindas do OpenStreetMap chegam sem telefone, e
-- quase todo telefone que vem e fixo. O cadastro de CNPJ traz telefone (muitas
-- vezes o celular do dono), e-mail, atividade (CNAE) e bairro de toda empresa
-- ativa.
--
-- COMO FUNCIONA:
--   1. scripts/cnpj/extrair_cnpj.py baixa o cadastro no computador do Estevam
--      e filtra: Rio de Janeiro, ATIVA, matriz, com nome fantasia, segmento-
--      alvo, Zona Norte, telefone que nao e de contador (numero repetido em
--      muitas empresas e descartado).
--   2. scripts/cnpj/carregar_reserva.py grava o resultado AQUI, na reserva.
--      A reserva NAO e a lista de prospeccao: nada aqui vira mensagem.
--   3. No painel, "Buscar novas empresas" com a fonte "Cadastro CNPJ" chama
--      trazer_do_cnpj(), que puxa poucas por vez (maximo 30) para a base de
--      empresas, ja com a checagem de "nao contatar" e de duplicata.
--
-- LGPD: telefone de MEI costuma ser o celular pessoal do dono, e isso e dado
-- pessoal. Por isso: so o minimo necessario (nada de razao social com CPF,
-- nada de socios); a reserva e restrita ao workspace; o que nao for usado
-- pode ser apagado com limpar_reserva_cnpj(); e a abordagem continua com
-- identificacao e saida facil (rodape e "nao contatar").

create table if not exists public.cnpj_reserva (
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  cnpj             text not null check (cnpj ~ '^\d{14}$'),
  nome             text not null check (char_length(nome) between 2 and 200),
  segmento         text not null check (char_length(segmento) between 2 and 40),
  categoria        text not null check (char_length(categoria) between 2 and 40),
  cnae             text not null check (cnae ~ '^\d{7}$'),
  regiao           text not null check (char_length(regiao) between 2 and 40),
  bairro           text,
  cep              text check (cep is null or cep ~ '^\d{8}$'),
  endereco         text,
  telefone1        text check (telefone1 is null or telefone1 ~ '^\d{10,11}$'),
  telefone2        text check (telefone2 is null or telefone2 ~ '^\d{10,11}$'),
  email            text check (email is null or char_length(email) <= 254),
  inicio_atividade date,
  referencia       text not null check (referencia ~ '^\d{4}-\d{2}$'),
  carregado_em     timestamptz not null default now(),
  -- preenchido quando a linha sai da reserva (importada, duplicada ou suprimida)
  processado_em    timestamptz,
  resultado        text check (resultado is null or resultado in ('importada', 'duplicada', 'suprimida')),
  company_id       uuid,
  primary key (workspace_id, cnpj),
  constraint cnpj_reserva_com_telefone check (telefone1 is not null or telefone2 is not null)
);

create index if not exists cnpj_reserva_disponiveis_idx
  on public.cnpj_reserva (workspace_id, segmento, regiao)
  where processado_em is null;

alter table public.cnpj_reserva enable row level security;

-- Membros so LEEM (para o painel mostrar quantas ainda ha). Escrita so pelo
-- carregador (service_role) e pelas funcoes abaixo.
drop policy if exists "membros leem a reserva" on public.cnpj_reserva;
create policy "membros leem a reserva" on public.cnpj_reserva
  for select to authenticated using (private.is_workspace_member(workspace_id));

revoke all on table public.cnpj_reserva from anon, authenticated;
grant select on table public.cnpj_reserva to authenticated;
grant all on table public.cnpj_reserva to service_role;

-- Regra de pontuacao: CNPJ ativo em segmento-alvo e um sinal real (a empresa
-- existe, esta ativa e e do ramo). Sem ela, lead de mercado ou curso sem
-- e-mail ficava abaixo do minimo so porque o cadastro nao tem Instagram.
update public.rule_sets rs
   set rules = rs.rules || jsonb_build_array(jsonb_build_object(
         'field', 'signals.cnpj_ativo', 'operator', 'present', 'points', 20,
         'reason', 'CNPJ ativo em segmento-alvo (cadastro da Receita)'))
 where jsonb_typeof(rs.rules) = 'array'
   and not exists (
     select 1 from jsonb_array_elements(rs.rules) r where r->>'field' = 'signals.cnpj_ativo'
   );

-- -----------------------------------------------------------------------------
-- trazer_do_cnpj: puxa poucas empresas da reserva para a base de prospeccao.
-- -----------------------------------------------------------------------------
create or replace function public.trazer_do_cnpj(
  p_workspace uuid,
  p_segmento  text,
  p_regioes   text[] default null,
  p_limite    integer default 20
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          public.cnpj_reserva;
  fonte      uuid;
  fone       text;
  cel        text;
  nova       uuid;
  existente  uuid;
  importadas int := 0;
  duplicadas int := 0;
  suprimidas int := 0;
  restantes  int;
  limite     int := least(greatest(coalesce(p_limite, 20), 1), 30);
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  if not private.is_workspace_member(p_workspace) then
    raise exception 'Sem acesso a este espaço de trabalho.' using errcode = 'insufficient_privilege';
  end if;
  if p_segmento is null or char_length(p_segmento) > 40 then raise exception 'Segmento inválido.'; end if;

  insert into public.lead_sources (workspace_id, source_type, name, query)
  values (p_workspace, 'other', 'Cadastro CNPJ (Receita) · ' || p_segmento,
          jsonb_build_object('source', 'receita_cnpj', 'segmento', p_segmento, 'regioes', p_regioes, 'limite', limite))
  returning id into fonte;

  -- Celular primeiro (vira WhatsApp), depois as empresas mais novas: quem
  -- abriu ha pouco tempo e quem mais precisa montar a presenca digital.
  for r in
    select * from public.cnpj_reserva
     where workspace_id = p_workspace
       and processado_em is null
       and segmento = p_segmento
       and (p_regioes is null or regiao = any (p_regioes))
     order by (coalesce(telefone1, '') ~ '^\d{2}9\d{8}$' or coalesce(telefone2, '') ~ '^\d{2}9\d{8}$') desc,
              inicio_atividade desc nulls last
     for update skip locked
  loop
    exit when importadas >= limite;

    cel := case when r.telefone1 ~ '^\d{2}9\d{8}$' then r.telefone1
                when r.telefone2 ~ '^\d{2}9\d{8}$' then r.telefone2 end;
    fone := coalesce(cel, r.telefone1, r.telefone2);

    -- "Nao contatar" vale para o telefone, o e-mail e o proprio CNPJ.
    if public.is_suppressed(p_workspace, fone, r.email, null, 'cnpj:' || r.cnpj)
       or (r.telefone2 is not null and public.is_suppressed(p_workspace, r.telefone2, null, null, null))
       or (r.telefone1 is not null and public.is_suppressed(p_workspace, r.telefone1, null, null, null)) then
      update public.cnpj_reserva set processado_em = now(), resultado = 'suprimida'
       where workspace_id = r.workspace_id and cnpj = r.cnpj;
      suprimidas := suprimidas + 1;
      continue;
    end if;

    -- Ja esta na base? (mesmo CNPJ, mesmo telefone ou mesmo nome no mesmo bairro)
    select c.id into existente
      from public.companies c
     where c.workspace_id = p_workspace
       and (c.source_ref = 'cnpj:' || r.cnpj
            or public.normalize_phone_br(c.main_phone) in (r.telefone1, r.telefone2)
            or (c.normalized_name = lower(r.nome) and r.bairro is not null
                and position(lower(r.bairro) in lower(coalesce(c.address_line, ''))) > 0))
     limit 1;

    if existente is not null then
      update public.cnpj_reserva set processado_em = now(), resultado = 'duplicada', company_id = existente
       where workspace_id = r.workspace_id and cnpj = r.cnpj;
      duplicadas := duplicadas + 1;
      continue;
    end if;

    insert into public.companies (
      workspace_id, source_id, source_ref, name, normalized_name, main_phone, main_email,
      address_line, city, state, country, category, status, metadata, signals,
      last_seen_at, consent_basis, data_source_url, data_collected_at)
    values (
      p_workspace, fonte, 'cnpj:' || r.cnpj, r.nome, lower(r.nome),
      '+55 ' || left(fone, 2) || ' ' || substr(fone, 3),
      r.email,
      concat_ws(' - ', nullif(r.endereco, ''), nullif(r.bairro, '')),
      'Rio de Janeiro', 'RJ', 'BR', r.categoria, 'new',
      jsonb_build_object('fonte', 'receita_cnpj', 'cnpj', r.cnpj, 'cnae', r.cnae,
                         'bairro', r.bairro, 'cep', r.cep, 'regiao', r.regiao,
                         'referencia', r.referencia, 'inicio_atividade', r.inicio_atividade,
                         'telefone_alternativo', case when r.telefone1 is distinct from fone then r.telefone1
                                                      when r.telefone2 is distinct from fone then r.telefone2 end),
      jsonb_build_object('has_phone', true, 'has_email', r.email is not null,
                         'has_any_contact', true, 'has_address', r.endereco is not null,
                         'has_website', false, 'has_instagram', false, 'has_whatsapp', false,
                         'has_social', false, 'is_chain', false, 'cnpj_ativo', true),
      now(), 'legitimate_interest',
      'https://dados.gov.br/dados/conjuntos-dados/cadastro-nacional-da-pessoa-juridica---cnpj',
      r.carregado_em)
    returning id into nova;

    perform public.enfileirar_tarefa(p_workspace, nova, 'analyze_company', 60,
                                     jsonb_build_object('source_id', fonte));

    update public.cnpj_reserva set processado_em = now(), resultado = 'importada', company_id = nova
     where workspace_id = r.workspace_id and cnpj = r.cnpj;
    importadas := importadas + 1;
  end loop;

  select count(*) into restantes
    from public.cnpj_reserva
   where workspace_id = p_workspace and processado_em is null and segmento = p_segmento
     and (p_regioes is null or regiao = any (p_regioes));

  return jsonb_build_object('importadas', importadas, 'duplicadas', duplicadas,
                            'suprimidas', suprimidas, 'restantes', restantes);
end;
$$;

revoke all on function public.trazer_do_cnpj(uuid, text, text[], integer) from public, anon;
grant execute on function public.trazer_do_cnpj(uuid, text, text[], integer) to authenticated;

-- -----------------------------------------------------------------------------
-- resumo_reserva_cnpj: quantas ainda ha por segmento e regiao (para o painel).
-- -----------------------------------------------------------------------------
create or replace function public.resumo_reserva_cnpj(p_workspace uuid)
returns table (segmento text, regiao text, disponiveis bigint, com_celular bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.segmento, r.regiao, count(*),
         count(*) filter (where coalesce(r.telefone1, '') ~ '^\d{2}9\d{8}$'
                             or coalesce(r.telefone2, '') ~ '^\d{2}9\d{8}$')
    from public.cnpj_reserva r
   where r.workspace_id = p_workspace and r.processado_em is null
   group by 1, 2
   order by 1, 2;
$$;

revoke all on function public.resumo_reserva_cnpj(uuid) from public, anon;
grant execute on function public.resumo_reserva_cnpj(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- limpar_reserva_cnpj: apaga o que nao foi usado (minimizacao, LGPD art. 6, III).
-- So o dono do workspace. As empresas ja importadas continuam na base.
-- -----------------------------------------------------------------------------
create or replace function public.limpar_reserva_cnpj(p_workspace uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare apagadas integer;
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  if not exists (select 1 from public.workspaces w where w.id = p_workspace and w.owner_id = auth.uid()) then
    raise exception 'Só o proprietário pode limpar a reserva.' using errcode = 'insufficient_privilege';
  end if;
  delete from public.cnpj_reserva where workspace_id = p_workspace and processado_em is null;
  get diagnostics apagadas = row_count;
  return apagadas;
end;
$$;

revoke all on function public.limpar_reserva_cnpj(uuid) from public, anon;
grant execute on function public.limpar_reserva_cnpj(uuid) to authenticated;
