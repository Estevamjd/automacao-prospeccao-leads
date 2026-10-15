-- I13 (29/09): busca ampla em duas fontes (cadastro CNPJ + mapa), juntando os
-- dados de cada empresa, e o que o painel novo em 4 passos precisa.
--
-- O QUE MUDA:
--   1. cnpj_reserva passa a cobrir estados inteiros (RJ e SP agora; Brasil
--      depois): UF, municipio e zona (so nas capitais). A tabela estava vazia
--      (a carga nunca rodou), entao ela e recriada.
--   2. mesclar_empresa(): o coracao da busca unica. Recebe uma empresa vinda
--      de qualquer fonte e decide: e nova (insere) ou ja existe (completa o
--      que falta). Mesma empresa = mesmo telefone, ou nome parecido + mesma
--      rua/CEP/ponto no mapa. Na duvida NAO junta (insere e marca "possivel
--      duplicata"): juntar errado mandaria a mensagem de uma empresa para o
--      celular de outra.
--   3. trazer_do_cnpj() v2 (UF/municipio/zona/bairros) e ingerir_do_mapa()
--      usam o mesmo mesclar_empresa().
--   4. Funcoes de leitura para os filtros do painel (geografia, bairros,
--      quantas por segmento) e a view empresas_painel (canal ja calculado).
--   5. editar_rascunho(): salvar a mensagem personalizada ("o que voce viu"),
--      sem nunca perder o rodape de saida.
--   6. finalizar_carga_reserva(): a carga mensal apaga da reserva o que saiu
--      do cadastro (empresa fechou) e nao foi usado — minimizacao da LGPD.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
-- O Supabase ja da esse acesso; fica explicito para o banco de teste local.
grant usage on schema extensions to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Normalizacao (usada para comparar nomes e ruas entre as fontes)
-- ---------------------------------------------------------------------------
create or replace function public.normalizar_texto(p text)
returns text language sql stable set search_path = '' as $$
  select nullif(btrim(regexp_replace(lower(extensions.unaccent(coalesce(p, ''))), '[^a-z0-9]+', ' ', 'g')), '');
$$;

-- Nome de empresa sem sufixo juridico ("ltda", "me", "eireli"...), que muda
-- entre as fontes e atrapalharia a comparacao.
create or replace function public.normalizar_nome_empresa(p text)
returns text language sql stable set search_path = '' as $$
  select nullif(btrim(regexp_replace(regexp_replace(
           coalesce(public.normalizar_texto(p), ''),
           '\m(ltda|me|mei|epp|eireli|sa|s a|cia|comercio|servicos|de|da|do|das|dos|e)\M', ' ', 'g'), '\s+', ' ', 'g')), '');
$$;

-- Rua sem o tipo e sem o numero: "R. Paulo Silva Araujo, 10" -> "paulo silva araujo".
create or replace function public.normalizar_rua(p text)
returns text language sql stable set search_path = '' as $$
  select nullif(btrim(
           regexp_replace(
             regexp_replace(
               coalesce(public.normalizar_texto(split_part(split_part(coalesce(p, ''), ',', 1), ' - ', 1)), ''),
               '^(rua|r|avenida|av|estrada|estr|est|travessa|tv|trav|praca|pca|pc|alameda|al|rodovia|rod|largo|lgo|beco|via)\s+', ''),
             '(\s+s\s+n\M|\s+\d+).*$', '')), '');
$$;

-- ---------------------------------------------------------------------------
-- 1. Reserva do cadastro de CNPJ, agora por UF/municipio/zona
-- ---------------------------------------------------------------------------
drop function if exists public.trazer_do_cnpj(uuid, text, text[], integer);
drop function if exists public.resumo_reserva_cnpj(uuid);
drop table if exists public.cnpj_reserva;

create table public.cnpj_reserva (
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  cnpj             text not null check (cnpj ~ '^\d{14}$'),
  nome             text not null check (char_length(nome) between 2 and 200),
  segmento         text not null check (char_length(segmento) between 2 and 40),
  categoria        text not null check (char_length(categoria) between 2 and 40),
  cnae             text not null check (cnae ~ '^\d{7}$'),
  uf               text not null check (uf ~ '^[A-Z]{2}$'),
  municipio        text not null check (char_length(municipio) between 2 and 80),
  -- zona so existe nas capitais (Rio: norte, sul, oeste, centro, barra; SP:
  -- centro, norte, sul, leste, oeste). Nas outras cidades fica nula.
  zona             text check (zona is null or char_length(zona) between 2 and 20),
  bairro           text,
  cep              text check (cep is null or cep ~ '^\d{8}$'),
  endereco         text,
  telefone1        text check (telefone1 is null or telefone1 ~ '^\d{10,11}$'),
  telefone2        text check (telefone2 is null or telefone2 ~ '^\d{10,11}$'),
  email            text check (email is null or char_length(email) <= 254),
  inicio_atividade date,
  referencia       text not null check (referencia ~ '^\d{4}-\d{2}$'),
  carregado_em     timestamptz not null default now(),
  processado_em    timestamptz,
  resultado        text check (resultado is null or resultado in ('importada', 'completada', 'duplicada', 'suprimida')),
  company_id       uuid,
  primary key (workspace_id, cnpj),
  constraint cnpj_reserva_com_telefone check (telefone1 is not null or telefone2 is not null)
);

create index cnpj_reserva_busca_idx
  on public.cnpj_reserva (workspace_id, uf, municipio, segmento)
  where processado_em is null;
create index cnpj_reserva_referencia_idx on public.cnpj_reserva (workspace_id, uf, referencia);

alter table public.cnpj_reserva enable row level security;
create policy "membros leem a reserva" on public.cnpj_reserva
  for select to authenticated using (private.is_workspace_member(workspace_id));
revoke all on table public.cnpj_reserva from anon, authenticated;
grant select on table public.cnpj_reserva to authenticated;
grant all on table public.cnpj_reserva to service_role;

-- ---------------------------------------------------------------------------
-- 2. mesclar_empresa: insere ou completa (uso interno, via as funcoes abaixo)
-- ---------------------------------------------------------------------------
-- p_dados (jsonb):
--   source_ref, name, telefones[] (digitos), main_email, website_url,
--   instagram_url, address_line, cep, bairro, city, state, category,
--   lat, lon, metadata{}, signals{}, data_source_url, source_id
-- Devolve: acao ('inserida' | 'completada' | 'igual' | 'suprimida' | 'sem_contato')
--          e o id da empresa.
create or replace function public.mesclar_empresa(p_workspace uuid, p_dados jsonb, p_fonte text)
returns table (acao text, company_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  nome      text := btrim(coalesce(p_dados->>'name', ''));
  nome_n    text := public.normalizar_nome_empresa(p_dados->>'name');
  rua_n     text := public.normalizar_rua(p_dados->>'address_line');
  cep       text := nullif(regexp_replace(coalesce(p_dados->>'cep', ''), '\D', '', 'g'), '');
  cidade    text := nullif(btrim(coalesce(p_dados->>'city', '')), '');
  email     text := nullif(lower(btrim(coalesce(p_dados->>'main_email', ''))), '');
  site      text := nullif(btrim(coalesce(p_dados->>'website_url', '')), '');
  insta     text := nullif(btrim(coalesce(p_dados->>'instagram_url', '')), '');
  ref       text := nullif(btrim(coalesce(p_dados->>'source_ref', '')), '');
  lat       double precision := nullif(p_dados->>'lat', '')::double precision;
  lon       double precision := nullif(p_dados->>'lon', '')::double precision;
  fones     text[];
  celular   text;
  principal text;
  c         public.companies;
  achado    uuid;
  parecido  uuid;
  meta      jsonb;
  sinais    jsonb;
  mudou_contato boolean := false;
  campos    jsonb := '{}'::jsonb;
begin
  if nome = '' or nome_n is null then
    return query select 'sem_contato'::text, null::uuid; return;
  end if;

  -- telefones validos, sem repeticao, celular primeiro
  select coalesce(array_agg(t order by (t ~ '^\d{2}9\d{8}$') desc, ord), '{}')
    into fones
    from (select distinct on (public.normalize_phone_br(x)) public.normalize_phone_br(x) t, ord
            from jsonb_array_elements_text(coalesce(p_dados->'telefones', '[]'::jsonb)) with ordinality e(x, ord)
           where public.normalize_phone_br(x) is not null
           order by public.normalize_phone_br(x), ord) f;
  celular := (select t from unnest(fones) t where t ~ '^\d{2}9\d{8}$' limit 1);
  principal := fones[1];

  if principal is null and email is null and site is null and insta is null then
    return query select 'sem_contato'::text, null::uuid; return;
  end if;

  -- "Nao contatar" vale para qualquer telefone, o e-mail e a origem.
  if exists (select 1 from unnest(fones) t where public.is_suppressed(p_workspace, t, null, null, null))
     or public.is_suppressed(p_workspace, null, email, null, ref) then
    return query select 'suprimida'::text, null::uuid; return;
  end if;

  -- a) mesma origem  b) mesmo telefone  c) nome parecido + mesmo lugar
  select x.id into achado from public.companies x
   where x.workspace_id = p_workspace and ref is not null and x.source_ref = ref limit 1;

  if achado is null and array_length(fones, 1) > 0 then
    select x.id into achado from public.companies x
     where x.workspace_id = p_workspace
       and (public.normalize_phone_br(x.main_phone) = any (fones)
            or coalesce(x.metadata->'telefones', '[]'::jsonb) ?| fones)
     limit 1;
  end if;

  if achado is null then
    select x.id into achado from public.companies x
     where x.workspace_id = p_workspace
       and (cidade is null or x.city is null or public.normalizar_texto(x.city) = public.normalizar_texto(cidade))
       and extensions.similarity(public.normalizar_nome_empresa(x.name), nome_n) >= 0.45
       and (   (cep is not null and x.metadata->>'cep' = cep)
            or (rua_n is not null and public.normalizar_rua(x.address_line) = rua_n)
            or (lat is not null and (x.metadata->>'lat') is not null
                and abs((x.metadata->>'lat')::double precision - lat) < 0.0015
                and abs((x.metadata->>'lon')::double precision - lon) < 0.0015))
     order by extensions.similarity(public.normalizar_nome_empresa(x.name), nome_n) desc
     limit 1;
  end if;

  -- ------------------------------------------------------------- completar
  if achado is not null then
    select * into c from public.companies where id = achado for update;

    if c.opt_out_at is not null then
      return query select 'suprimida'::text, c.id; return;
    end if;

    meta := coalesce(c.metadata, '{}'::jsonb);
    -- origem e telefones conhecidos (uniao)
    meta := meta || jsonb_build_object(
      'fontes', (select jsonb_agg(distinct f) from jsonb_array_elements_text(
                   coalesce(meta->'fontes', '[]'::jsonb) || to_jsonb(array[p_fonte])) f),
      'telefones', (select coalesce(jsonb_agg(distinct t), '[]'::jsonb) from (
                   select jsonb_array_elements_text(coalesce(meta->'telefones', '[]'::jsonb)) t
                   union select unnest(fones)
                   union select public.normalize_phone_br(c.main_phone)) u where t is not null));
    -- dados da fonte que ainda nao existem (nunca sobrescreve)
    meta := coalesce(p_dados->'metadata', '{}'::jsonb) || meta;
    if cep is not null and not meta ? 'cep' then meta := meta || jsonb_build_object('cep', cep); end if;
    if lat is not null and not meta ? 'lat' then meta := meta || jsonb_build_object('lat', lat, 'lon', lon); end if;

    -- campos: so preenche o que falta e nunca toca no que o Estevam confirmou
    if not c.manual_overrides ? 'main_phone' and principal is not null then
      if c.main_phone is null
         or (celular is not null and coalesce(public.normalize_phone_br(c.main_phone), '') !~ '^\d{2}9\d{8}$') then
        campos := campos || jsonb_build_object('main_phone', '+55 ' || left(coalesce(celular, principal), 2) || ' ' || substr(coalesce(celular, principal), 3));
        mudou_contato := true;
      end if;
    end if;
    if not c.manual_overrides ? 'main_email' and c.main_email is null and email is not null then
      campos := campos || jsonb_build_object('main_email', email);
      mudou_contato := mudou_contato or c.main_phone is null;
    end if;
    if not c.manual_overrides ? 'website_url' and c.website_url is null and site is not null then
      campos := campos || jsonb_build_object('website_url', site);
    end if;
    if not c.manual_overrides ? 'instagram_url' and c.instagram_url is null and insta is not null then
      campos := campos || jsonb_build_object('instagram_url', insta);
    end if;
    if not c.manual_overrides ? 'address_line' and c.address_line is null and p_dados->>'address_line' is not null then
      campos := campos || jsonb_build_object('address_line', p_dados->>'address_line');
    end if;

    -- sinais: o que uma fonte viu, vale (true ganha)
    sinais := coalesce(c.signals, '{}'::jsonb);
    select sinais || coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into sinais
      from jsonb_each(coalesce(p_dados->'signals', '{}'::jsonb)) s(k, v)
     where jsonb_typeof(v) = 'boolean' and (v = 'true'::jsonb or not sinais ? k);

    if campos = '{}'::jsonb and meta = coalesce(c.metadata, '{}'::jsonb) and sinais = coalesce(c.signals, '{}'::jsonb) then
      return query select 'igual'::text, c.id; return;
    end if;

    update public.companies x set
      main_phone    = coalesce(campos->>'main_phone', x.main_phone),
      main_email    = coalesce(campos->>'main_email', x.main_email),
      website_url   = coalesce(campos->>'website_url', x.website_url),
      instagram_url = coalesce(campos->>'instagram_url', x.instagram_url),
      address_line  = coalesce(campos->>'address_line', x.address_line),
      category      = coalesce(x.category, nullif(p_dados->>'category', '')),
      metadata      = meta,
      signals       = sinais || jsonb_build_object(
                        'has_phone', coalesce(campos->>'main_phone', x.main_phone) is not null,
                        'has_email', coalesce(campos->>'main_email', x.main_email) is not null,
                        'has_website', coalesce(campos->>'website_url', x.website_url) is not null,
                        'has_instagram', coalesce(campos->>'instagram_url', x.instagram_url) is not null,
                        'has_any_contact', true),
      last_seen_at  = now()
     where x.id = c.id;

    -- Canal melhorou (ganhou celular ou ganhou o primeiro contato): a
    -- mensagem aberta foi escrita para o canal antigo. Refaz.
    if mudou_contato and c.status in ('new', 'researching', 'qualified', 'ready_for_outreach', 'rejected') then
      update public.outreach_messages set status = 'cancelled'
       where company_id = c.id and status = 'draft' and sent_at is null;
      perform public.enfileirar_tarefa(p_workspace, c.id, 'analyze_company', 65, jsonb_build_object('motivo', 'contato_novo'));
    end if;

    update public.knowledge_notes set sync_status = 'pending'
     where workspace_id = p_workspace and entity_id = c.id and entity_type = 'company';
    return query select 'completada'::text, c.id; return;
  end if;

  -- ------------------------------------------------------------- inserir
  -- Nome muito parecido na mesma cidade, mas sem prova de que e o mesmo
  -- lugar: entra separado, com aviso para o Estevam decidir.
  select x.id into parecido from public.companies x
   where x.workspace_id = p_workspace
     and (cidade is null or x.city is null or public.normalizar_texto(x.city) = public.normalizar_texto(cidade))
     and extensions.similarity(public.normalizar_nome_empresa(x.name), nome_n) >= 0.75
   order by extensions.similarity(public.normalizar_nome_empresa(x.name), nome_n) desc
   limit 1;

  meta := coalesce(p_dados->'metadata', '{}'::jsonb) || jsonb_build_object(
            'fontes', jsonb_build_array(p_fonte),
            'telefones', to_jsonb(fones));
  if cep is not null then meta := meta || jsonb_build_object('cep', cep); end if;
  if lat is not null then meta := meta || jsonb_build_object('lat', lat, 'lon', lon); end if;
  if parecido is not null then meta := meta || jsonb_build_object('possivel_duplicata', parecido); end if;

  insert into public.companies (
    workspace_id, source_id, source_ref, name, normalized_name, main_phone, main_email,
    website_url, instagram_url, address_line, city, state, country, category, status,
    metadata, signals, last_seen_at, consent_basis, data_source_url, data_collected_at)
  values (
    p_workspace, nullif(p_dados->>'source_id', '')::uuid, ref, nome, lower(nome),
    case when principal is not null then '+55 ' || left(principal, 2) || ' ' || substr(principal, 3) end,
    email, site, insta, nullif(p_dados->>'address_line', ''), cidade,
    nullif(p_dados->>'state', ''), 'BR', nullif(p_dados->>'category', ''), 'new',
    meta,
    coalesce(p_dados->'signals', '{}'::jsonb) || jsonb_build_object(
      'has_phone', principal is not null, 'has_email', email is not null,
      'has_website', site is not null, 'has_instagram', insta is not null,
      'has_any_contact', true),
    now(), 'legitimate_interest', nullif(p_dados->>'data_source_url', ''), now())
  returning id into achado;

  perform public.enfileirar_tarefa(p_workspace, achado, 'analyze_company', 60,
                                   jsonb_build_object('fonte', p_fonte));
  return query select 'inserida'::text, achado;
end;
$$;

revoke all on function public.mesclar_empresa(uuid, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3a. trazer_do_cnpj v2
-- ---------------------------------------------------------------------------
create or replace function public.trazer_do_cnpj(
  p_workspace uuid,
  p_segmento  text,
  p_uf        text,
  p_municipio text    default null,
  p_zona      text    default null,
  p_bairros   text[]  default null,
  p_limite    integer default 20
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r        public.cnpj_reserva;
  res      record;
  fonte    uuid;
  novas    int := 0;
  completadas int := 0;
  suprimidas  int := 0;
  iguais      int := 0;
  restantes   int;
  limite   int := least(greatest(coalesce(p_limite, 20), 1), 50);
  bairros_n text[] := (select array_agg(public.normalizar_texto(b)) from unnest(coalesce(p_bairros, '{}')) b where btrim(b) <> '');
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  if not private.is_workspace_member(p_workspace) then
    raise exception 'Sem acesso a este espaço de trabalho.' using errcode = 'insufficient_privilege';
  end if;
  if p_segmento is null or char_length(p_segmento) > 40 or p_uf !~ '^[A-Z]{2}$' then
    raise exception 'Escolha o estado e o segmento.';
  end if;

  insert into public.lead_sources (workspace_id, source_type, name, query)
  values (p_workspace, 'other', 'Cadastro CNPJ · ' || p_segmento || ' · ' || coalesce(p_municipio, p_uf),
          jsonb_build_object('source', 'receita_cnpj', 'segmento', p_segmento, 'uf', p_uf,
                             'municipio', p_municipio, 'zona', p_zona, 'bairros', p_bairros))
  returning id into fonte;

  -- Celular primeiro (vira WhatsApp); depois as empresas mais novas.
  for r in
    select * from public.cnpj_reserva x
     where x.workspace_id = p_workspace and x.processado_em is null
       and x.segmento = p_segmento and x.uf = p_uf
       and (p_municipio is null or x.municipio = p_municipio)
       and (p_zona is null or x.zona = p_zona)
       and (bairros_n is null or public.normalizar_texto(x.bairro) = any (bairros_n))
     order by (coalesce(x.telefone1, '') ~ '^\d{2}9\d{8}$' or coalesce(x.telefone2, '') ~ '^\d{2}9\d{8}$') desc,
              x.inicio_atividade desc nulls last
     limit limite * 3
     for update skip locked
  loop
    exit when novas + completadas >= limite;

    select * into res from public.mesclar_empresa(p_workspace, jsonb_build_object(
      'source_ref', 'cnpj:' || r.cnpj,
      'name', r.nome,
      'telefones', to_jsonb(array_remove(array[r.telefone1, r.telefone2], null)),
      'main_email', r.email,
      'address_line', concat_ws(' - ', nullif(r.endereco, ''), nullif(r.bairro, '')),
      'cep', r.cep, 'city', r.municipio, 'state', r.uf, 'category', r.categoria,
      'source_id', fonte,
      'data_source_url', 'https://dados.gov.br/dados/conjuntos-dados/cadastro-nacional-da-pessoa-juridica---cnpj',
      'metadata', jsonb_build_object('fonte', 'receita_cnpj', 'cnpj', r.cnpj, 'cnae', r.cnae,
                                     'bairro', r.bairro, 'zona', r.zona, 'uf', r.uf,
                                     'referencia', r.referencia, 'inicio_atividade', r.inicio_atividade),
      'signals', jsonb_build_object('cnpj_ativo', true, 'has_address', r.endereco is not null,
                                    'is_chain', false)), 'cnpj');

    update public.cnpj_reserva set processado_em = now(), company_id = res.company_id,
           resultado = case res.acao when 'inserida' then 'importada' when 'suprimida' then 'suprimida'
                                     when 'igual' then 'duplicada' else 'completada' end
     where workspace_id = r.workspace_id and cnpj = r.cnpj;

    case res.acao
      when 'inserida'   then novas := novas + 1;
      when 'completada' then completadas := completadas + 1;
      when 'suprimida'  then suprimidas := suprimidas + 1;
      else iguais := iguais + 1;
    end case;
  end loop;

  select count(*) into restantes from public.cnpj_reserva x
   where x.workspace_id = p_workspace and x.processado_em is null
     and x.segmento = p_segmento and x.uf = p_uf
     and (p_municipio is null or x.municipio = p_municipio)
     and (p_zona is null or x.zona = p_zona)
     and (bairros_n is null or public.normalizar_texto(x.bairro) = any (bairros_n));

  return jsonb_build_object('novas', novas, 'completadas', completadas, 'suprimidas', suprimidas,
                            'ja_estavam', iguais, 'restantes', restantes);
end;
$$;

revoke all on function public.trazer_do_cnpj(uuid, text, text, text, text, text[], integer) from public, anon;
grant execute on function public.trazer_do_cnpj(uuid, text, text, text, text, text[], integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3b. ingerir_do_mapa: empresas do OpenStreetMap (o painel monta os dados)
-- ---------------------------------------------------------------------------
create or replace function public.ingerir_do_mapa(p_workspace uuid, p_leads jsonb, p_descricao text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l      jsonb;
  res    record;
  fonte  uuid;
  cont   jsonb := jsonb_build_object('novas', 0, 'completadas', 0, 'suprimidas', 0, 'sem_contato', 0, 'ja_estavam', 0);
  chave  text;
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  if not private.is_workspace_member(p_workspace) then
    raise exception 'Sem acesso a este espaço de trabalho.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_leads) <> 'array' or jsonb_array_length(p_leads) > 400 then
    raise exception 'Lote inválido (máximo 400 empresas por vez).';
  end if;

  insert into public.lead_sources (workspace_id, source_type, name, query)
  values (p_workspace, 'other', left('Mapa (OpenStreetMap) · ' || coalesce(p_descricao, 'busca'), 200),
          jsonb_build_object('source', 'openstreetmap_overpass', 'descricao', p_descricao))
  returning id into fonte;

  for l in select * from jsonb_array_elements(p_leads) loop
    if jsonb_typeof(l) <> 'object' or char_length(coalesce(l->>'name', '')) > 200
       or coalesce(l->>'source_ref', '') !~ '^osm:(node|way|relation)/\d+$' then
      continue;
    end if;
    select * into res from public.mesclar_empresa(p_workspace, l || jsonb_build_object('source_id', fonte), 'mapa');
    chave := case res.acao when 'inserida' then 'novas' when 'completada' then 'completadas'
                           when 'suprimida' then 'suprimidas' when 'sem_contato' then 'sem_contato' else 'ja_estavam' end;
    cont := jsonb_set(cont, array[chave], to_jsonb((cont->>chave)::int + 1));
  end loop;

  return cont;
end;
$$;

revoke all on function public.ingerir_do_mapa(uuid, jsonb, text) from public, anon;
grant execute on function public.ingerir_do_mapa(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Leitura para os filtros do painel
-- ---------------------------------------------------------------------------
create or replace function public.geografia_reserva(p_workspace uuid)
returns table (uf text, municipio text, zona text, disponiveis bigint, com_celular bigint)
language sql stable security invoker set search_path = '' as $$
  select r.uf, r.municipio, r.zona, count(*),
         count(*) filter (where coalesce(r.telefone1, '') ~ '^\d{2}9\d{8}$' or coalesce(r.telefone2, '') ~ '^\d{2}9\d{8}$')
    from public.cnpj_reserva r
   where r.workspace_id = p_workspace and r.processado_em is null
   group by 1, 2, 3;
$$;

create or replace function public.bairros_reserva(p_workspace uuid, p_uf text, p_municipio text, p_zona text default null)
returns table (bairro text, disponiveis bigint)
language sql stable security invoker set search_path = '' as $$
  select min(r.bairro), count(*)
    from public.cnpj_reserva r
   where r.workspace_id = p_workspace and r.processado_em is null
     and r.uf = p_uf and r.municipio = p_municipio
     and (p_zona is null or r.zona = p_zona)
     and r.bairro is not null
   group by public.normalizar_texto(r.bairro)
   order by 2 desc
   limit 250;
$$;

create or replace function public.resumo_reserva_cnpj(
  p_workspace uuid, p_uf text, p_municipio text default null, p_zona text default null, p_bairros text[] default null)
returns table (segmento text, disponiveis bigint, com_celular bigint)
language sql stable security invoker set search_path = '' as $$
  select r.segmento, count(*),
         count(*) filter (where coalesce(r.telefone1, '') ~ '^\d{2}9\d{8}$' or coalesce(r.telefone2, '') ~ '^\d{2}9\d{8}$')
    from public.cnpj_reserva r
   where r.workspace_id = p_workspace and r.processado_em is null and r.uf = p_uf
     and (p_municipio is null or r.municipio = p_municipio)
     and (p_zona is null or r.zona = p_zona)
     and (p_bairros is null or public.normalizar_texto(r.bairro) in
          (select public.normalizar_texto(b) from unnest(p_bairros) b))
   group by 1;
$$;

revoke all on function public.geografia_reserva(uuid) from public, anon;
revoke all on function public.bairros_reserva(uuid, text, text, text) from public, anon;
revoke all on function public.resumo_reserva_cnpj(uuid, text, text, text, text[]) from public, anon;
grant execute on function public.geografia_reserva(uuid) to authenticated;
grant execute on function public.bairros_reserva(uuid, text, text, text) to authenticated;
grant execute on function public.resumo_reserva_cnpj(uuid, text, text, text, text[]) to authenticated;
grant execute on function public.normalizar_texto(text) to authenticated;

-- Canal ja calculado para o painel filtrar e paginar por canal.
-- security_invoker: a view respeita o RLS de companies de quem consulta.
grant execute on function public.canal_de_abordagem(text, text, jsonb) to authenticated;
create or replace view public.empresas_painel with (security_invoker = true) as
select c.*,
       case when c.main_phone is null and c.main_email is null
                 and coalesce(c.signals->>'has_whatsapp', '') not in ('true', 't')
            then 'sem_contato'
            else public.canal_de_abordagem(c.main_phone, c.main_email, c.signals) end as canal
  from public.companies c;
revoke all on public.empresas_painel from anon;
grant select on public.empresas_painel to authenticated;

-- ---------------------------------------------------------------------------
-- 5. editar_rascunho: salvar a mensagem personalizada
-- ---------------------------------------------------------------------------
create or replace function public.editar_rascunho(p_message uuid, p_body text, p_observacoes jsonb default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m     public.outreach_messages;
  cfg   jsonb;
  corpo text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  select * into m from public.outreach_messages where id = p_message for update;
  if not found or not private.is_workspace_member(m.workspace_id) then
    raise exception 'Mensagem não encontrada.';
  end if;
  if m.status <> 'draft' or m.sent_at is not null then
    raise exception 'Só dá para editar mensagem que ainda não foi enviada.';
  end if;
  if char_length(corpo) < 10 or char_length(corpo) > 4000 then
    raise exception 'A mensagem precisa ter entre 10 e 4.000 caracteres.';
  end if;
  if p_observacoes is not null and (jsonb_typeof(p_observacoes) <> 'object' or length(p_observacoes::text) > 2000) then
    raise exception 'Observações inválidas.';
  end if;

  -- O rodape de saida (LGPD, art. 18) nao pode sumir na edicao.
  if m.channel in ('whatsapp', 'email') and not public.ja_tem_opt_out(corpo) then
    select w.settings into cfg from public.workspaces w where w.id = m.workspace_id;
    corpo := corpo || public.rodape_lgpd(m.channel, cfg #>> '{remetente,nome}', cfg #>> '{remetente,contato}');
  end if;

  update public.outreach_messages
     set body = corpo,
         personalization_used = (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements(
           coalesce(personalization_used, '[]'::jsonb) || '["editada"]'::jsonb) x)
   where id = m.id;

  if p_observacoes is not null then
    update public.companies
       set metadata = metadata || jsonb_build_object('observacoes',
             p_observacoes || jsonb_build_object('registrado_em', now(), 'por', auth.uid()))
     where id = m.company_id;
  end if;
  return m.id;
end;
$$;

revoke all on function public.editar_rascunho(uuid, text, jsonb) from public, anon;
grant execute on function public.editar_rascunho(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Limpeza da carga mensal (so o carregador, com a chave de servico)
-- ---------------------------------------------------------------------------
create or replace function public.finalizar_carga_reserva(p_workspace uuid, p_referencia text, p_ufs text[])
returns integer
language plpgsql security definer set search_path = '' as $$
declare apagadas integer;
begin
  delete from public.cnpj_reserva
   where workspace_id = p_workspace and processado_em is null
     and uf = any (p_ufs) and referencia < p_referencia;
  get diagnostics apagadas = row_count;
  return apagadas;
end;
$$;

revoke all on function public.finalizar_carga_reserva(uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.finalizar_carga_reserva(uuid, text, text[]) to service_role;
