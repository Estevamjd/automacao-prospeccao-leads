-- 30/09: todos os numeros de cada empresa, e escolher para qual mandar.
--
-- O cadastro de CNPJ traz ate 2 telefones e o mapa pode trazer outros; a
-- juncao (mesclar_empresa) ja guarda todos em companies.metadata.telefones.
-- Faltava usar: o painel so mostrava o telefone principal. Agora:
--
-- 1) confirmar_whatsapp ganha p_telefone (opcional). O teste de WhatsApp vale
--    POR NUMERO (metadata.whatsapp_numeros = {"2133334444": true, ...}).
--    Confirmar um numero que nao e o principal faz dele o principal (a
--    mensagem vai para quem tem WhatsApp), a menos que o principal tenha sido
--    conferido a mao. "Nao tem" num numero secundario nao muda nada no canal.
--    Chamada antiga (sem p_telefone) continua valendo para o principal.
-- 2) usar_telefone: trocar o principal por outro numero ja conhecido da
--    empresa (so numero que alguma fonte trouxe; numero novo continua sendo
--    pela ficha, em "Editar e confirmar dados").
-- Nos dois, se o numero ou o canal mudar antes do primeiro contato, o
-- rascunho aberto e cancelado e a mensagem e refeita (mesma regra da juncao).

drop function if exists public.confirmar_whatsapp(uuid, boolean);

create or replace function public.confirmar_whatsapp(p_company uuid, p_tem boolean, p_telefone text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c          public.companies;
  sinais     jsonb;
  meta       jsonb;
  principal  text;
  alvo       text;
  conhecidos text[];
  novo_main  text;
  antes      text;
  depois     text;
  trocou     boolean := false;
  refeita    boolean := false;
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  if p_tem is null then raise exception 'Informe se tem WhatsApp.'; end if;

  select * into c from public.companies where id = p_company for update;
  if not found or not private.is_workspace_member(c.workspace_id) then
    raise exception 'Empresa não encontrada.' using errcode = 'insufficient_privilege';
  end if;
  if c.opt_out_at is not null then
    raise exception 'Empresa marcada como não contatar.';
  end if;

  principal := public.normalize_phone_br(c.main_phone);
  alvo := coalesce(public.normalize_phone_br(p_telefone), principal);
  if alvo is null then raise exception 'Telefone inválido.'; end if;

  select coalesce(array_agg(distinct t), '{}') into conhecidos from (
    select principal t
    union all
    select public.normalize_phone_br(x) from jsonb_array_elements_text(coalesce(c.metadata->'telefones', '[]'::jsonb)) x
  ) s where t is not null;
  if not alvo = any (conhecidos) then
    raise exception 'Esse número não é desta empresa.';
  end if;

  meta   := coalesce(c.metadata, '{}'::jsonb);
  meta   := meta || jsonb_build_object('whatsapp_numeros',
              coalesce(meta->'whatsapp_numeros', '{}'::jsonb) || jsonb_build_object(alvo, p_tem));
  sinais := coalesce(c.signals, '{}'::jsonb);
  antes  := public.canal_de_abordagem(c.main_phone, c.main_email, sinais);
  novo_main := c.main_phone;

  if alvo = principal then
    sinais := sinais || jsonb_build_object('has_whatsapp', p_tem);
  elsif p_tem and not coalesce(c.manual_overrides, '{}'::jsonb) ? 'main_phone' then
    -- WhatsApp confirmado num numero secundario: ele vira o principal.
    novo_main := '+55 ' || left(alvo, 2) || ' ' || substr(alvo, 3);
    sinais := sinais || jsonb_build_object('has_whatsapp', true);
    trocou := true;
  end if;
  sinais := sinais || jsonb_build_object('has_any_contact', true, 'has_phone', novo_main is not null);
  depois := public.canal_de_abordagem(novo_main, c.main_email, sinais);

  update public.companies set
    main_phone = novo_main,
    signals = sinais,
    metadata = meta,
    manual_overrides = coalesce(manual_overrides, '{}'::jsonb) || jsonb_build_object('has_whatsapp', jsonb_build_object(
      'original', c.signals->'has_whatsapp', 'valor', p_tem, 'telefone', alvo, 'confirmed_at', now(), 'confirmed_by', auth.uid()))
  where id = c.id;

  if (depois <> antes or trocou) and c.status in ('new', 'researching', 'qualified', 'ready_for_outreach', 'rejected') then
    update public.outreach_messages set status = 'cancelled'
     where company_id = c.id and status = 'draft' and sent_at is null;
    perform public.enfileirar_tarefa(c.workspace_id, c.id, 'analyze_company', 70,
                                     jsonb_build_object('motivo', 'whatsapp_confirmado'));
    refeita := true;
  end if;

  return jsonb_build_object('canal', depois, 'mensagem_refeita', refeita, 'principal_trocado', trocou,
                            'principal_conferido', alvo is distinct from principal and p_tem and not trocou);
end;
$$;

revoke all on function public.confirmar_whatsapp(uuid, boolean, text) from public, anon;
grant execute on function public.confirmar_whatsapp(uuid, boolean, text) to authenticated;


create or replace function public.usar_telefone(p_company uuid, p_telefone text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c          public.companies;
  alvo       text := public.normalize_phone_br(p_telefone);
  principal  text;
  conhecidos text[];
  sinais     jsonb;
  novo_main  text;
  antes      text;
  depois     text;
  refeita    boolean := false;
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  if alvo is null then raise exception 'Telefone inválido.'; end if;

  select * into c from public.companies where id = p_company for update;
  if not found or not private.is_workspace_member(c.workspace_id) then
    raise exception 'Empresa não encontrada.' using errcode = 'insufficient_privilege';
  end if;
  if c.opt_out_at is not null then
    raise exception 'Empresa marcada como não contatar.';
  end if;

  principal := public.normalize_phone_br(c.main_phone);
  if alvo = principal then
    return jsonb_build_object('canal', public.canal_de_abordagem(c.main_phone, c.main_email, c.signals), 'mensagem_refeita', false);
  end if;
  select coalesce(array_agg(distinct public.normalize_phone_br(x)), '{}') into conhecidos
    from jsonb_array_elements_text(coalesce(c.metadata->'telefones', '[]'::jsonb)) x;
  if not alvo = any (conhecidos) then
    raise exception 'Esse número não é desta empresa. Para um número novo, use "Editar e confirmar dados" na ficha.';
  end if;

  novo_main := '+55 ' || left(alvo, 2) || ' ' || substr(alvo, 3);
  -- O WhatsApp do numero novo vale o que ja foi testado para ele (se foi).
  sinais := coalesce(c.signals, '{}'::jsonb) - 'has_whatsapp';
  if c.metadata->'whatsapp_numeros' ? alvo then
    sinais := sinais || jsonb_build_object('has_whatsapp', (c.metadata->'whatsapp_numeros'->>alvo)::boolean);
  end if;
  antes  := public.canal_de_abordagem(c.main_phone, c.main_email, c.signals);
  depois := public.canal_de_abordagem(novo_main, c.main_email, sinais);

  update public.companies set
    main_phone = novo_main,
    signals = sinais || jsonb_build_object('has_phone', true, 'has_any_contact', true),
    manual_overrides = coalesce(manual_overrides, '{}'::jsonb) || jsonb_build_object('main_phone', jsonb_build_object(
      'original', case when manual_overrides ? 'main_phone' then manual_overrides->'main_phone'->'original' else to_jsonb(c.main_phone) end,
      'confirmed_at', clock_timestamp(), 'confirmed_by', auth.uid()))
  where id = c.id;

  insert into public.activities (workspace_id, company_id, activity_type, title, body, metadata)
  values (c.workspace_id, c.id, 'note', 'Telefone principal trocado',
          'Mensagens passam a ir para o número ' || novo_main || '.',
          jsonb_build_object('de', c.main_phone, 'para', novo_main, 'usuario', auth.uid()));

  if c.status in ('new', 'researching', 'qualified', 'ready_for_outreach', 'rejected') then
    update public.outreach_messages set status = 'cancelled'
     where company_id = c.id and status = 'draft' and sent_at is null;
    perform public.enfileirar_tarefa(c.workspace_id, c.id, 'analyze_company', 70,
                                     jsonb_build_object('motivo', 'telefone_trocado'));
    refeita := true;
  end if;

  return jsonb_build_object('canal', depois, 'mensagem_refeita', refeita);
end;
$$;

revoke all on function public.usar_telefone(uuid, text) from public, anon;
grant execute on function public.usar_telefone(uuid, text) to authenticated;
