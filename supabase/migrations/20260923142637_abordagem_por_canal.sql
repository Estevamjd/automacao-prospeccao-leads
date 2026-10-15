-- I8 + C1 + C3 (23/09): abordagem que se apresenta, canal pelo tipo de numero.
--
-- 1) Telefone FIXO deixa de ser "whatsapp". Na base real de 23/09, 14 das 15
--    mensagens prontas eram para fixo: o banco dizia WhatsApp, o painel (que
--    so abre wa.me para celular) nao mostrava botao, e nada saia. Fixo agora
--    vira canal 'phone', com roteiro de ligacao em vez de mensagem.
--    A regra e a MESMA de _shared/canal.ts e de painel/lib/comercial.ts
--    (telefoneWhatsapp): celular = DDD + 9 + 8 digitos; fixo = DDD + [2-5] + 7.
--
-- 2) Rodape: ligacao nao tem rodape escrito (a saida "nao volto a ligar" esta
--    no roteiro). No WhatsApp o rodape nao assina mais: a primeira linha da
--    mensagem ja diz "Aqui e o Estevam", e assinar de novo fica com cara de
--    disparo em massa.
--
-- 3) niche_playbooks.apresentacao: a frase "Trabalho com ..." de cada nicho.
--    A abordagem nova se apresenta (quem sou, o que faco) antes de perguntar,
--    e nao aponta problema do negocio na primeira mensagem.
--
-- 4) Pergunta do petshop: "Como voces avisam que esta na hora do banho ou da
--    vacina?" pressupoe que nao avisam. A nova pergunta e neutra.
--
-- 5) remetente.bairro: a mensagem diz "sou de Olaria". Vem do bairro do
--    proprio workspace; nada de id fixo aqui.

-- 1) canal ------------------------------------------------------------------
create or replace function public.canal_de_abordagem(p_phone text, p_email text, p_signals jsonb)
returns text
language plpgsql
stable
set search_path to ''
as $function$
declare
  fone text;
  mail text;
begin
  fone := public.normalize_phone_br(p_phone);

  -- Celular recebe WhatsApp.
  if fone ~ '^\d{2}9\d{8}$' then
    return 'whatsapp';
  end if;

  -- Fixo com WhatsApp confirmado (WhatsApp Business em fixo existe).
  if coalesce(p_signals->>'has_whatsapp', '') in ('true', 't') then
    return 'whatsapp';
  end if;

  -- Fixo sem WhatsApp: ligacao com roteiro.
  if fone ~ '^\d{2}[2-5]\d{7}$' then
    return 'phone';
  end if;

  mail := lower(btrim(coalesce(p_email, '')));
  if mail ~ '^[^[:space:]@,;]+@[^[:space:]@,;]+\.[a-z]{2,}$' then
    return 'email';
  end if;

  return 'whatsapp';
end;
$function$;

-- 2) rodape -----------------------------------------------------------------
create or replace function public.rodape_lgpd(p_canal text, p_nome text default null, p_contato text default null)
returns text
language plpgsql
immutable
set search_path to ''
as $function$
declare
  nome    text := btrim(coalesce(p_nome, ''));
  contato text := btrim(coalesce(p_contato, ''));
begin
  -- Ligacao: a saida esta no roteiro, lida em voz alta.
  if p_canal = 'phone' then
    return '';
  end if;

  -- WhatsApp: uma linha, sem assinatura (o nome ja abre a mensagem).
  if p_canal = 'whatsapp' then
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
$function$;

-- 3) apresentacao por nicho --------------------------------------------------
alter table public.niche_playbooks
  add column if not exists apresentacao text;

alter table public.niche_playbooks
  drop constraint if exists niche_playbooks_apresentacao_tamanho;
alter table public.niche_playbooks
  add constraint niche_playbooks_apresentacao_tamanho
  check (apresentacao is null or char_length(apresentacao) between 10 and 200);

update public.niche_playbooks p
   set apresentacao = v.txt
  from (values
    ('academia',    'soluções para academias e estúdios da região acompanharem os alunos'),
    ('bar',         'divulgação e reservas pelo WhatsApp para bares da região'),
    ('beleza',      'agendamento online para salões e studios da região'),
    ('clinica',     'agendamento e confirmação de consultas para clínicas da região'),
    ('educacao',    'matrículas e atendimento pelo WhatsApp para escolas e cursos da região'),
    ('lanchonete',  'cardápio digital e pedidos pelo WhatsApp para lanchonetes da região'),
    ('mercado',     'pedidos pelo WhatsApp e entrega no bairro para o comércio da região'),
    ('odonto',      'confirmação de consultas para consultórios da região'),
    ('oficina',     'lembrete de revisão e orçamento pelo WhatsApp para oficinas da região'),
    ('petshop',     'agendamento e lembretes para pet shops da região'),
    ('pizzaria',    'pedido direto pelo WhatsApp, sem comissão de aplicativo, para pizzarias da região'),
    ('restaurante', 'presença no Google e reservas pelo WhatsApp para restaurantes da região')
  ) as v(slug, txt)
 where p.slug = v.slug
   and p.apresentacao is null;

-- 4) pergunta neutra do petshop --------------------------------------------
update public.niche_playbooks
   set opening_questions = array_replace(
         opening_questions,
         'Como vocês avisam hoje que está na hora do banho ou da vacina?',
         'Hoje o cliente volta por conta própria ou vocês costumam lembrar ele de voltar?'
       )
 where slug = 'petshop';

-- 5) bairro do remetente ------------------------------------------------------
update public.workspaces
   set settings = jsonb_set(settings, '{remetente,bairro}', to_jsonb(settings->>'neighborhood'), true)
 where settings ? 'remetente'
   and jsonb_typeof(settings->'remetente') = 'object'
   and coalesce(settings #>> '{remetente,bairro}', '') = ''
   and coalesce(settings->>'neighborhood', '') <> '';
