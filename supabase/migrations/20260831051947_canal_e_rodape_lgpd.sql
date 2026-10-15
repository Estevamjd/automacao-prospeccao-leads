-- =============================================================================
-- Canal de abordagem e rodape de LGPD, decididos NO BANCO.
-- =============================================================================
--
-- POR QUE ESTA MIGRACAO EXISTE:
--
-- Na primeira rodada real, cinco mensagens sairam marcadas como "email" para
-- empresas que so tinham telefone. A causa nao era regra de negocio: o canal
-- vinha do template escolhido, os dois message_templates tinham created_at
-- identico, e o "order by created_at" e instavel quando ha empate. Ou seja: o
-- canal de abordagem era efeito colateral de uma ordenacao.
--
-- A correcao esta em dois lugares de proposito:
--   1. No codigo (supabase/functions/_shared/canal.ts), que decide o canal a
--      partir do contato que a empresa realmente tem.
--   2. Aqui, como gatilho na tabela.
--
-- Isso NAO e duplicacao por descuido - e cinto e suspensorio deliberado, com
-- uma hierarquia clara: QUEM MANDA E O BANCO. Tres motivos:
--   a) outreach_messages tem mais de um escritor (Edge Function, painel e, em
--      breve, n8n). Regra que mora so num deles nao vale para os outros.
--   b) O rodape de LGPD e obrigacao legal; obrigacao legal nao pode depender
--      de qual cliente escreveu a linha.
--   c) Deploy de funcao e passo manual; migracao ja esta aplicada.
--
-- Se um dia as duas divergirem, o banco vence e o codigo esta errado.
--
-- LIMITE DELIBERADO: o gatilho so age no INSERT. Se voce abrir o painel e
-- trocar o canal na mao, a sua decisao fica - humano tem a palavra final.

-- -----------------------------------------------------------------------------
-- 1. Decisao de canal
-- -----------------------------------------------------------------------------

create or replace function public.canal_de_abordagem(
  p_phone   text,
  p_email   text,
  p_signals jsonb
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  fone text;
  mail text;
begin
  -- Telefone ganha do e-mail, e isso e escolha comercial, nao tecnica:
  -- na varredura real de Olaria 20% dos estabelecimentos tinham telefone e
  -- quase nenhum tinha e-mail, e comercio de bairro responde WhatsApp.
  fone := public.normalize_phone_br(p_phone);
  if fone is not null and length(fone) between 10 and 11 then
    return 'whatsapp';
  end if;

  if coalesce(p_signals->>'has_whatsapp', '') in ('true', 't') then
    return 'whatsapp';
  end if;

  mail := lower(btrim(coalesce(p_email, '')));
  if mail ~ '^[^[:space:]@,;]+@[^[:space:]@,;]+\.[a-z]{2,}$' then
    return 'email';
  end if;

  -- Sem contato nenhum a empresa nem deveria chegar aqui (o auditor bloqueia).
  -- Se chegar, whatsapp e o default menos pior.
  return 'whatsapp';
end;
$$;

comment on function public.canal_de_abordagem(text, text, jsonb) is
  'Canal de abordagem a partir do contato real da empresa. Telefone > WhatsApp > e-mail.';

-- -----------------------------------------------------------------------------
-- 2. Rodape de LGPD
-- -----------------------------------------------------------------------------
--
-- Abordagem fria B2B se apoia no legitimo interesse (LGPD art. 7, IX). O
-- legitimo interesse NAO dispensa transparencia: o art. 9 exige que a pessoa
-- saiba quem fala e por que, e o art. 18 exige jeito facil de pedir para parar.
-- Uma frase curta resolve os dois.

create or replace function public.ja_tem_opt_out(p_corpo text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_corpo, '') ~* '(n[aã]o (quiser|queira|receber))|descadastr|(remover seus dados)|(n[aã]o escrevo mais)|(sair da lista)';
$$;

create or replace function public.rodape_lgpd(
  p_canal   text,
  p_nome    text default null,
  p_contato text default null
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  nome    text := btrim(coalesce(p_nome, ''));
  contato text := btrim(coalesce(p_contato, ''));
begin
  -- No WhatsApp, bloco juridico parece spam. Uma linha basta.
  if p_canal = 'whatsapp' then
    if nome <> '' then
      return E'\n\n— ' || nome || '. Se não quiser receber mensagem minha, é só falar que eu não escrevo mais.';
    end if;
    return E'\n\nSe não quiser receber mensagem minha, é só falar que eu não escrevo mais.';
  end if;

  return E'\n\n—\n'
    || case when nome <> '' then nome || E'\n' else '' end
    || 'Escrevi para o endereço comercial publicado pelo próprio estabelecimento em fontes públicas, '
    || 'com base no legítimo interesse previsto na LGPD (art. 7º, IX). '
    || case
         when contato <> '' then 'Se preferir não receber mais contato, responda este e-mail ou escreva para '
                                 || contato || ' — eu removo seus dados na hora.'
         else 'Se preferir não receber mais contato, basta responder este e-mail dizendo isso — eu removo seus dados na hora.'
       end;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. O gatilho
-- -----------------------------------------------------------------------------
--
-- SECURITY DEFINER de proposito: o gatilho precisa ler companies e workspaces
-- para decidir, e quem insere pela Edge Function ou pelo painel pode ter RLS
-- restringindo essas leituras. Nao ha escalonamento util aqui - a funcao nao
-- DEVOLVE nada da empresa, so ajusta duas colunas da linha que o chamador ja
-- esta inserindo, e o RLS de outreach_messages continua decidindo se o insert
-- passa. O search_path fixo fecha o vetor classico de sequestro de schema.

create or replace function public.aplicar_canal_e_rodape()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  emp        record;
  cfg        jsonb;
  canal_certo text;
begin
  select c.main_phone, c.main_email, c.signals
    into emp
    from public.companies c
   where c.id = new.company_id;

  if not found then
    return new;  -- mensagem sem empresa: nao ha o que decidir
  end if;

  canal_certo := public.canal_de_abordagem(emp.main_phone, emp.main_email, emp.signals);

  if new.channel is distinct from canal_certo then
    new.channel := canal_certo;
  end if;

  -- Assunto so existe em e-mail.
  if new.channel <> 'email' then
    new.subject := null;
  end if;

  select w.settings into cfg from public.workspaces w where w.id = new.workspace_id;

  if new.body is not null and not public.ja_tem_opt_out(new.body) then
    new.body := new.body || public.rodape_lgpd(
      new.channel,
      coalesce(cfg #>> '{remetente,nome}', null),
      coalesce(cfg #>> '{remetente,contato}', null)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_outreach_canal_e_rodape on public.outreach_messages;
create trigger trg_outreach_canal_e_rodape
  before insert on public.outreach_messages
  for each row execute function public.aplicar_canal_e_rodape();

-- -----------------------------------------------------------------------------
-- 4. Permissoes
-- -----------------------------------------------------------------------------
-- O Supabase concede EXECUTE a "authenticated" em TODA funcao nova do schema
-- public via DEFAULT PRIVILEGES. Revogar so de "public, anon" nao basta - foi
-- exatamente assim que claim_next_task ficou exposta na primeira rodada.
revoke all on function public.canal_de_abordagem(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rodape_lgpd(text, text, text)          from public, anon, authenticated;
revoke all on function public.ja_tem_opt_out(text)                    from public, anon, authenticated;
revoke all on function public.aplicar_canal_e_rodape()                from public, anon, authenticated;
