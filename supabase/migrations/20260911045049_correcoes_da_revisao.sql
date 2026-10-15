-- =============================================================================
-- Correcoes apontadas na revisao de 11/09.
-- =============================================================================
--
-- A migracao anterior (20260911034356) foi aplicada e fica como esta: migracao
-- e historico, nao se reescreve o que ja rodou. As correcoes vem aqui.

-- -----------------------------------------------------------------------------
-- 1. Fechar a brecha entre workspaces
-- -----------------------------------------------------------------------------
--
-- O DEFEITO: ao_enviar_mensagem e aplicar_canal_e_rodape sao SECURITY DEFINER e
-- confiavam ao mesmo tempo em new.company_id e new.workspace_id, vindos da
-- mesma linha. Nada garantia que os dois pertencessem ao mesmo workspace, entao
-- um usuario autenticado podia, pela API direta, inserir uma mensagem no
-- workspace dele apontando para uma empresa de outro — e o gatilho, rodando com
-- privilegio do dono, mexeria na empresa alheia.
--
-- A correcao tem duas camadas. Primeiro a estrutural, que e a que realmente
-- resolve: uma chave estrangeira COMPOSTA. Com ela o banco recusa a linha
-- inconsistente antes de qualquer gatilho rodar.

-- Pre-requisito da FK composta: um indice unico em (id, workspace_id).
create unique index if not exists companies_id_workspace_uidx
  on public.companies(id, workspace_id);

-- Higiene antes de impor a regra: se existir linha torta, ela apareceria como
-- erro no meio do deploy. Aqui ela e corrigida para o workspace da empresa,
-- que e a fonte de verdade.
update public.outreach_messages m
   set workspace_id = c.workspace_id
  from public.companies c
 where c.id = m.company_id and m.workspace_id is distinct from c.workspace_id;

update public.follow_ups f
   set workspace_id = c.workspace_id
  from public.companies c
 where c.id = f.company_id and f.workspace_id is distinct from c.workspace_id;

alter table public.outreach_messages
  drop constraint if exists outreach_messages_company_workspace_fkey;
alter table public.outreach_messages
  add constraint outreach_messages_company_workspace_fkey
  foreign key (company_id, workspace_id)
  references public.companies(id, workspace_id) on delete cascade;

alter table public.follow_ups
  drop constraint if exists follow_ups_company_workspace_fkey;
alter table public.follow_ups
  add constraint follow_ups_company_workspace_fkey
  foreign key (company_id, workspace_id)
  references public.companies(id, workspace_id) on delete cascade;

-- Segunda camada: os proprios gatilhos param de confiar no workspace_id da
-- linha e passam a usar o da empresa, conferindo antes. Redundante com a FK
-- de proposito — se alguem um dia remover a constraint, o gatilho nao vira
-- uma porta aberta.

create or replace function public.aplicar_canal_e_rodape()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  emp         record;
  cfg         jsonb;
  canal_certo text;
begin
  select c.main_phone, c.main_email, c.signals, c.workspace_id
    into emp
    from public.companies c
   where c.id = new.company_id;

  if not found then
    return new;
  end if;

  -- A empresa manda. Mensagem apontando para empresa de outro workspace e
  -- recusada em voz alta, nao corrigida em silencio: corrigir esconderia a
  -- tentativa e ainda gravaria a linha no workspace da vitima.
  if new.workspace_id is distinct from emp.workspace_id then
    raise exception 'Mensagem e empresa em workspaces diferentes.'
      using errcode = 'check_violation';
  end if;

  canal_certo := public.canal_de_abordagem(emp.main_phone, emp.main_email, emp.signals);

  if new.channel is distinct from canal_certo then
    new.channel := canal_certo;
  end if;

  if new.channel <> 'email' then
    new.subject := null;
  end if;

  select w.settings into cfg from public.workspaces w where w.id = new.workspace_id;

  if new.body is not null and not public.ja_tem_opt_out(new.body) then
    new.body := new.body || public.rodape_lgpd(
      new.channel,
      cfg #>> '{remetente,nome}',
      cfg #>> '{remetente,contato}'
    );
  end if;

  return new;
end;
$$;

create or replace function public.ao_enviar_mensagem()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
begin
  if new.sent_at is null or old.sent_at is not null then
    return null;
  end if;

  -- O workspace vem da EMPRESA, nunca da mensagem. Sem isto, uma linha forjada
  -- faria esta funcao (que roda com privilegio do dono) escrever em dado alheio.
  select c.workspace_id into ws
    from public.companies c
   where c.id = new.company_id
     and c.workspace_id = new.workspace_id;

  if ws is null then
    raise exception 'Mensagem e empresa em workspaces diferentes.'
      using errcode = 'check_violation';
  end if;

  update public.companies
     set status = 'contacted'
   where id = new.company_id
     and workspace_id = ws
     and status in ('new', 'researching', 'qualified', 'ready_for_outreach');

  insert into public.follow_ups (workspace_id, company_id, message_id, due_at, notes)
  select ws, new.company_id, new.id,
         new.sent_at + interval '3 days',
         'Sem resposta ate aqui? Mande UM follow-up e pare. Insistir e o que vira incomodo.'
   where not exists (
     select 1 from public.follow_ups f
      where f.message_id = new.id and f.status = 'scheduled'
   );

  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. "Marcar como enviada" numa transacao so
-- -----------------------------------------------------------------------------
--
-- O DEFEITO: a rota do painel atualizava mensagem, empresa e follow-up em
-- chamadas separadas, ignorava parte dos erros e aceitava marcar como enviada
-- uma mensagem cancelada ou ja processada. Meia atualizacao deixa o funil
-- mentindo.
--
-- SECURITY INVOKER de proposito: quem chama e o usuario logado, e o RLS de
-- outreach_messages decide o que ele alcanca. Nao ha privilegio emprestado.

create or replace function public.marcar_mensagem_enviada(
  p_message  uuid,
  p_desfazer boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  m    public.outreach_messages;
  nome text;
begin
  if auth.uid() is null then
    raise exception 'Faca login.' using errcode = 'insufficient_privilege';
  end if;

  -- FOR UPDATE: dois cliques rapidos no mesmo botao nao viram dois envios.
  select * into m from public.outreach_messages where id = p_message for update;
  if not found then
    raise exception 'Mensagem nao encontrada.' using errcode = 'no_data_found';
  end if;

  select c.name into nome from public.companies c where c.id = m.company_id;

  if p_desfazer then
    if m.sent_at is null then
      return jsonb_build_object('mensagem', 'Essa mensagem ja estava como nao enviada.', 'alterou', false);
    end if;

    update public.follow_ups
       set status = 'cancelled',
           notes  = coalesce(notes, '') || ' [cancelado: envio desfeito]'
     where message_id = m.id and status = 'scheduled';

    update public.companies
       set status = 'ready_for_outreach'
     where id = m.company_id and status = 'contacted';

    update public.outreach_messages
       set status = 'draft', sent_at = null
     where id = m.id;

    return jsonb_build_object(
      'mensagem', format('Desfeito. %s voltou para a lista de prontos.', coalesce(nome, 'A empresa')),
      'alterou', true);
  end if;

  if m.sent_at is not null then
    return jsonb_build_object('mensagem', 'Essa mensagem ja estava marcada como enviada.', 'alterou', false);
  end if;

  -- So rascunho vira enviada. Cancelada, falhada ou substituida nao.
  if m.status <> 'draft' then
    raise exception 'Só um rascunho aberto pode ser marcado como enviado (esta está como %).', m.status
      using errcode = 'check_violation';
  end if;

  update public.outreach_messages
     set status = 'sent', sent_at = now()
   where id = m.id;

  return jsonb_build_object(
    'mensagem', format('Anotado: %s foi abordada. Retorno marcado para daqui a 3 dias.', coalesce(nome, 'a empresa')),
    'alterou', true);
end;
$$;

revoke all on function public.marcar_mensagem_enviada(uuid, boolean) from public, anon;
grant execute on function public.marcar_mensagem_enviada(uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Um resumo so
-- -----------------------------------------------------------------------------
--
-- resumo_do_workspace foi criada sem eu ver que resumo_comercial ja existia e
-- ja era consumida pelo painel. Dois resumos concorrentes e o comeco da
-- divergencia: some o duplicado e os contadores novos entram no que ja existia.

drop view if exists public.resumo_do_workspace;

create or replace function public.resumo_comercial(p_workspace uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'total', count(*),
    'prontos', count(*) filter (where status = 'ready_for_outreach' and opt_out_at is null),
    'conversas', count(*) filter (where status in ('contacted','responded','meeting_scheduled')),
    'contratos', count(*) filter (where status = 'won'),
    'valorContratos', coalesce(sum(case when status = 'won' then nullif(metadata->'comercial'->>'valor','')::numeric else 0 end),0),
    'scoreMedio', coalesce(round(avg(score)),0),
    'optOut', count(*) filter (where opt_out_at is not null),
    'revisoesHumanas', (select count(*) from public.agent_tasks where workspace_id=p_workspace and task_type='human_review' and status='pending'),
    'tarefasPendentes', (select count(*) from public.agent_tasks where workspace_id=p_workspace and task_type in ('analyze_company','audit_company','draft_outreach') and status='pending'),
    'tarefasComFalha', (select count(*) from public.agent_tasks where workspace_id=p_workspace and status='failed'),
    'rascunhosAbertos', (select count(*) from public.outreach_messages where workspace_id=p_workspace and status='draft' and sent_at is null),
    'mensagensEnviadas', (select count(*) from public.outreach_messages where workspace_id=p_workspace and sent_at is not null)
  ) from public.companies where workspace_id=p_workspace;
$$;
