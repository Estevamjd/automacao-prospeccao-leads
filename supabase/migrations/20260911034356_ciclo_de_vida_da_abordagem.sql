-- =============================================================================
-- Ciclo de vida da abordagem: proteger o estado, um rascunho por empresa,
-- follow-up que nasce no envio, e um resumo com numero certo.
-- =============================================================================
--
-- Esta migracao corrige tres defeitos encontrados olhando o comportamento real
-- da base depois de 11 dias de uso (222 empresas, 18 rascunhos, 0 envios).

-- -----------------------------------------------------------------------------
-- 1. O status da empresa nao pode voltar para 'new' numa reimportacao
-- -----------------------------------------------------------------------------
--
-- O DEFEITO: ingest-leads manda status:'new' no payload do upsert. Como o
-- conflito em source_ref faz UPDATE, reimportar um estabelecimento jogava o
-- status de volta para 'new' — e a linha seguinte da funcao ("so enfileira
-- quem esta em new") passava a enfileirar a base inteira.
--
-- A PROVA: 222 empresas geraram 257 analises e 208 auditorias, e tres empresas
-- ficaram com rascunho duplicado (28/08 e 09/09).
--
-- O QUE ISSO CUSTARIA DEPOIS: assim que existir "marcar como enviada", a
-- proxima varredura apagaria essa marca e geraria rascunho novo para quem ja
-- foi abordado. Reabordar o mesmo comerciante queima o lead e enfraquece o
-- legitimo interesse que sustenta a operacao inteira.
--
-- POR QUE NO BANCO: companies tem varios escritores (ingest-leads, painel,
-- n8n). Regra que mora em um deles nao vale para os outros.

create or replace function public.proteger_status_da_empresa()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Reimportacao nao rebobina o funil. Uma empresa que ja foi analisada,
  -- descartada ou contatada continua onde estava.
  if new.status = 'new'
     and old.status is distinct from 'new'
     and coalesce(current_setting('app.permitir_reset_status', true), '') <> 'on'
  then
    new.status := old.status;
  end if;

  return new;
end;
$$;

comment on function public.proteger_status_da_empresa() is
  'Impede que reimportacao devolva a empresa para o inicio do funil. Para forcar um reset consciente: set local app.permitir_reset_status = ''on''.';

drop trigger if exists trg_proteger_status_da_empresa on public.companies;
create trigger trg_proteger_status_da_empresa
  before update on public.companies
  for each row execute function public.proteger_status_da_empresa();

-- -----------------------------------------------------------------------------
-- 2. Uma empresa tem no maximo UM rascunho aberto
-- -----------------------------------------------------------------------------
--
-- Rascunho novo substitui o anterior em vez de conviver com ele. Cancelar e
-- melhor que apagar: o texto antigo fica no historico, e da para comparar o
-- que o consultor dizia antes.

create or replace function public.substituir_rascunho_anterior()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'draft' and new.sent_at is null then
    update public.outreach_messages
       set status = 'cancelled'
     where company_id = new.company_id
       and id <> new.id
       and sent_at is null
       and status = 'draft';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_outreach_substituir_rascunho on public.outreach_messages;
create trigger trg_outreach_substituir_rascunho
  before insert on public.outreach_messages
  for each row execute function public.substituir_rascunho_anterior();

-- Limpeza dos duplicados que ja existiam: mantem o mais recente de cada
-- empresa e cancela os anteriores. Nada e apagado.
update public.outreach_messages m
   set status = 'cancelled'
 where m.status = 'draft'
   and m.sent_at is null
   and exists (
     select 1 from public.outreach_messages n
      where n.company_id = m.company_id
        and n.status = 'draft'
        and n.sent_at is null
        and (n.created_at, n.id) > (m.created_at, m.id)
   );

-- Com os dados limpos, a garantia vira estrutural: nem um bug futuro nem uma
-- chamada manual conseguem criar dois rascunhos abertos para a mesma empresa.
create unique index if not exists outreach_um_rascunho_aberto_por_empresa
  on public.outreach_messages(company_id)
  where status = 'draft' and sent_at is null;

-- -----------------------------------------------------------------------------
-- 3. Follow-up nasce no ENVIO, nao no rascunho
-- -----------------------------------------------------------------------------
--
-- O DEFEITO: rascunhar() criava o follow-up na hora de escrever, com
-- due_at = +3 dias, sem saber se a mensagem seria enviada. Resultado real:
-- 5 follow-ups vencidos de mensagens que nunca sairam. Cobranca de uma coisa
-- que nao aconteceu e o jeito mais rapido de fazer alguem ignorar o alerta.

create or replace function public.ao_enviar_mensagem()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sent_at is not null and old.sent_at is null then

    -- A empresa avanca no funil. Esta era a transicao que nao existia:
    -- nada no sistema conseguia dizer "esse eu ja falei".
    update public.companies
       set status = 'contacted'
     where id = new.company_id
       and status in ('new', 'researching', 'qualified', 'ready_for_outreach');

    -- Follow-up contado a partir do envio de verdade.
    insert into public.follow_ups (workspace_id, company_id, message_id, due_at, notes)
    select new.workspace_id, new.company_id, new.id,
           new.sent_at + interval '3 days',
           'Sem resposta ate aqui? Mande UM follow-up e pare. Insistir e o que vira incomodo.'
     where not exists (
       select 1 from public.follow_ups f
        where f.message_id = new.id and f.status = 'scheduled'
     );
  end if;

  return null;
end;
$$;

drop trigger if exists trg_outreach_ao_enviar on public.outreach_messages;
create trigger trg_outreach_ao_enviar
  after update on public.outreach_messages
  for each row execute function public.ao_enviar_mensagem();

-- Cancela os follow-ups orfaos: agendados para mensagem que nunca foi enviada.
update public.follow_ups f
   set status = 'cancelled',
       notes = coalesce(f.notes, '') || ' [cancelado: a mensagem nunca foi enviada]'
  from public.outreach_messages m
 where m.id = f.message_id
   and f.status = 'scheduled'
   and m.sent_at is null;

-- -----------------------------------------------------------------------------
-- 4. Resumo com numero certo
-- -----------------------------------------------------------------------------
--
-- O DEFEITO: o painel buscava empresas com limit(80) e calculava o resumo em
-- cima dessa lista. Com 222 empresas ele exibia "total: 80". Contador tem que
-- vir de count no banco, nunca de length de uma pagina.
--
-- security_invoker = on: a view roda com as permissoes de quem consulta,
-- entao o RLS continua valendo e ninguem ve resumo de workspace alheio.

create or replace view public.resumo_do_workspace
with (security_invoker = on) as
select
  w.id as workspace_id,
  (select count(*) from public.companies c where c.workspace_id = w.id) as total,
  (select count(*) from public.companies c where c.workspace_id = w.id and c.status = 'qualified') as qualificados,
  (select count(*) from public.companies c where c.workspace_id = w.id and c.status = 'ready_for_outreach') as prontos,
  (select count(*) from public.companies c where c.workspace_id = w.id and c.status = 'contacted') as contatados,
  (select count(*) from public.companies c where c.workspace_id = w.id and c.opt_out_at is not null) as opt_out,
  (select coalesce(round(avg(c.score)), 0) from public.companies c where c.workspace_id = w.id and c.score is not null) as score_medio,
  -- Fila de trabalho da maquina: NAO inclui human_review, que e fila sua.
  (select count(*) from public.agent_tasks t
    where t.workspace_id = w.id and t.status in ('pending','running') and t.task_type <> 'human_review') as tarefas_pendentes,
  (select count(*) from public.agent_tasks t
    where t.workspace_id = w.id and t.status = 'pending' and t.task_type = 'human_review') as esperando_voce,
  (select count(*) from public.agent_tasks t
    where t.workspace_id = w.id and t.status = 'failed') as tarefas_com_falha,
  (select count(*) from public.outreach_messages m
    where m.workspace_id = w.id and m.status = 'draft' and m.sent_at is null) as rascunhos_abertos,
  (select count(*) from public.outreach_messages m
    where m.workspace_id = w.id and m.sent_at is not null) as mensagens_enviadas
from public.workspaces w;

comment on view public.resumo_do_workspace is
  'Contadores exatos do painel. Existe porque o resumo era calculado sobre uma lista truncada em 80 linhas.';

-- -----------------------------------------------------------------------------
-- 5. Indices das chaves estrangeiras mais usadas
-- -----------------------------------------------------------------------------
--
-- Com 222 linhas isso e irrelevante. Com 50 mil — que e a direcao do projeto —
-- cada abertura do painel vira varredura completa de tabela. Custa pouco agora
-- e evita a lentidao que so aparece quando ja incomoda.

create index if not exists activities_company_idx          on public.activities(company_id);
create index if not exists agent_tasks_company_idx         on public.agent_tasks(company_id);
create index if not exists agent_runs_workspace_idx        on public.agent_runs(workspace_id);
create index if not exists follow_ups_company_idx          on public.follow_ups(company_id);
create index if not exists follow_ups_message_idx          on public.follow_ups(message_id);
create index if not exists evidence_items_company_idx      on public.evidence_items(company_id);
create index if not exists contacts_company_idx            on public.contacts(company_id);
create index if not exists outreach_messages_template_idx  on public.outreach_messages(template_id);
create index if not exists companies_source_idx            on public.companies(source_id);
create index if not exists workspaces_owner_idx            on public.workspaces(owner_id);

-- -----------------------------------------------------------------------------
-- 6. Permissoes
-- -----------------------------------------------------------------------------
-- O Supabase concede EXECUTE a "authenticated" em toda funcao nova do schema
-- public via DEFAULT PRIVILEGES. Revogar so de "public, anon" nao basta.
revoke all on function public.proteger_status_da_empresa()   from public, anon, authenticated;
revoke all on function public.substituir_rascunho_anterior() from public, anon, authenticated;
revoke all on function public.ao_enviar_mensagem()           from public, anon, authenticated;

-- A view, ao contrario, e para o painel ler — e o security_invoker garante
-- que cada um so enxerga o proprio workspace.
grant select on public.resumo_do_workspace to authenticated;
