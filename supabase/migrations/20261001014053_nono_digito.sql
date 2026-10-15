-- 01/10: celulares do cadastro de CNPJ sem o nono digito.
--
-- O campo de telefone da Receita guarda o numero no formato antigo (DDD + 8
-- digitos). Pela regra da Anatel, numero de 8 digitos que comeca com 6, 7, 8
-- ou 9 e celular, e o celular de hoje e esse numero com um 9 na frente. O
-- extrator (scripts/cnpj/celulares.py) faz a conversao depois de checar que o
-- arquivo esta mesmo no formato antigo, e marca cada numero convertido.
--
-- 1) cnpj_reserva.telefones_inferidos: os numeros que ganharam o 9.
-- 2) trazer_do_cnpj passa essa lista para companies.metadata.telefones_inferidos;
--    o painel mostra "9 acrescentado" e pede para conferir o nome no WhatsApp
--    antes de enviar.
-- A ordem "celular primeiro" do trazer_do_cnpj passa a funcionar sozinha,
-- porque o numero convertido ja tem 11 digitos.

alter table public.cnpj_reserva
  add column if not exists telefones_inferidos text[] not null default '{}';
alter table public.cnpj_reserva
  drop constraint if exists cnpj_reserva_telefones_inferidos_formato;
alter table public.cnpj_reserva
  add constraint cnpj_reserva_telefones_inferidos_formato
  check (cardinality(telefones_inferidos) <= 2
         and array_to_string(telefones_inferidos, ',') ~ '^(\d{2}9\d{8}(,\d{2}9\d{8})?)?$');

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
                                     'referencia', r.referencia, 'inicio_atividade', r.inicio_atividade,
                                     -- 01/10: celulares que ganharam o nono digito (regra da Anatel)
                                     'telefones_inferidos', to_jsonb(r.telefones_inferidos)),
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

-- 3) descartar_telefone: "Número errado". Se o WhatsApp abrir com o nome de
--    outra pessoa (o celular antigo pode ter mudado de dono), o numero sai da
--    empresa e entra na lista de nao contatar, para nenhuma busca futura
--    abordar essa pessoa de novo (LGPD). Se era o principal, o proximo numero
--    conhecido (celular primeiro) assume e a mensagem e refeita.
create or replace function public.descartar_telefone(p_company uuid, p_telefone text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c          public.companies;
  alvo       text := public.normalize_phone_br(p_telefone);
  principal  text;
  conhecidos text[];
  restantes  text[];
  novo_main  text;
  sinais     jsonb;
  meta       jsonb;
  refeita    boolean := false;
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  if alvo is null then raise exception 'Telefone inválido.'; end if;

  select * into c from public.companies where id = p_company for update;
  if not found or not private.is_workspace_member(c.workspace_id) then
    raise exception 'Empresa não encontrada.' using errcode = 'insufficient_privilege';
  end if;

  principal := public.normalize_phone_br(c.main_phone);
  select coalesce(array_agg(distinct t), '{}') into conhecidos from (
    select principal t
    union all
    select public.normalize_phone_br(x) from jsonb_array_elements_text(coalesce(c.metadata->'telefones', '[]'::jsonb)) x
  ) s where t is not null;
  if not alvo = any (conhecidos) then
    raise exception 'Esse número não é desta empresa.';
  end if;

  -- o que sobra, celular primeiro
  select coalesce(array_agg(t order by (t ~ '^\d{2}9\d{8}$') desc, t), '{}') into restantes
    from unnest(conhecidos) t where t <> alvo;

  sinais := coalesce(c.signals, '{}'::jsonb);
  novo_main := c.main_phone;
  if alvo = principal then
    novo_main := case when restantes[1] is not null then '+55 ' || left(restantes[1], 2) || ' ' || substr(restantes[1], 3) end;
    sinais := sinais - 'has_whatsapp';
    if restantes[1] is not null and c.metadata->'whatsapp_numeros' ? restantes[1] then
      sinais := sinais || jsonb_build_object('has_whatsapp', (c.metadata->'whatsapp_numeros'->>restantes[1])::boolean);
    end if;
  end if;

  meta := coalesce(c.metadata, '{}'::jsonb) || jsonb_build_object(
    'telefones', to_jsonb(restantes),
    'telefones_descartados', (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from (
        select jsonb_array_elements_text(coalesce(c.metadata->'telefones_descartados', '[]'::jsonb)) x
        union select alvo) d),
    'telefones_inferidos', (select coalesce(jsonb_agg(x), '[]'::jsonb)
        from jsonb_array_elements_text(coalesce(c.metadata->'telefones_inferidos', '[]'::jsonb)) x where x <> alvo));

  update public.companies set
    main_phone = novo_main,
    metadata = meta,
    signals = sinais || jsonb_build_object('has_phone', novo_main is not null,
                                           'has_any_contact', novo_main is not null or c.main_email is not null)
  where id = c.id;

  insert into public.suppression_list (workspace_id, match_type, match_value, reason)
  values (c.workspace_id, 'phone', alvo, 'Número de outra pessoa (marcado como errado no painel)')
  on conflict (workspace_id, match_type, match_value) do nothing;

  insert into public.activities (workspace_id, company_id, activity_type, title, body, metadata)
  values (c.workspace_id, c.id, 'note', 'Telefone errado descartado',
          'O número não era da empresa e foi para a lista de não contatar.',
          jsonb_build_object('era_principal', alvo = principal, 'usuario', auth.uid()));

  if alvo = principal and c.opt_out_at is null
     and c.status in ('new', 'researching', 'qualified', 'ready_for_outreach', 'rejected') then
    update public.outreach_messages set status = 'cancelled'
     where company_id = c.id and status = 'draft' and sent_at is null;
    if novo_main is not null or c.main_email is not null then
      perform public.enfileirar_tarefa(c.workspace_id, c.id, 'analyze_company', 70,
                                       jsonb_build_object('motivo', 'telefone_errado'));
    end if;
    refeita := true;
  end if;

  return jsonb_build_object('principal', novo_main, 'mensagem_refeita', refeita, 'restantes', cardinality(restantes));
end;
$$;

revoke all on function public.descartar_telefone(uuid, text) from public, anon;
grant execute on function public.descartar_telefone(uuid, text) to authenticated;
