-- C7 (24/09): mudar a etapa pelo Andamento fecha a mensagem aberta.
--
-- O PROBLEMA: havia dois caminhos para registrar o contato, e so um deles
-- fechava a mensagem.
--   - "Marcar como enviada" (Mensagens): fecha o rascunho, agenda o retorno
--     de 3 dias e move a empresa para "Contato feito".
--   - Andamento -> "Contato feito": movia a empresa e mais nada. O rascunho
--     continuava em "Mensagens prontas" e nenhum retorno era agendado.
-- Foi o que aconteceu com o Studio Gab Costa em 23/09.
--
-- A REGRA AGORA, venha a mudanca de onde vier:
--   - de uma etapa antes do contato para "Contato feito", "Respondeu" ou
--     "Reuniao marcada": o rascunho aberto vira ENVIADO. O gatilho de envio
--     (ao_enviar_mensagem) agenda o retorno de 3 dias como sempre; se o
--     Andamento trouxer uma data de retorno, salvar_acompanhamento cancela a
--     de 3 dias e grava a sua (ele roda depois deste gatilho).
--   - para "Contrato fechado", "Nao fechou" ou "Descartado": o rascunho
--     aberto e CANCELADO. Nao faz sentido deixar mensagem de primeiro contato
--     na fila de quem ja fechou, recusou ou saiu.
--
-- Sem recursao: ao marcar o rascunho como enviado, ao_enviar_mensagem tenta
-- mover a empresa para "Contato feito" so se ela estiver antes do contato —
-- e aqui ela ja passou dessa etapa, entao nada mais dispara.

create or replace function public.rascunho_segue_a_etapa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  if old.status in ('new', 'researching', 'qualified', 'ready_for_outreach')
     and new.status in ('contacted', 'responded', 'meeting_scheduled') then
    update public.outreach_messages
       set status = 'sent', sent_at = now()
     where company_id = new.id
       and workspace_id = new.workspace_id
       and status = 'draft'
       and sent_at is null;

  elsif new.status in ('won', 'lost', 'rejected') then
    update public.outreach_messages
       set status = 'cancelled'
     where company_id = new.id
       and workspace_id = new.workspace_id
       and status = 'draft'
       and sent_at is null;
  end if;

  return null;
end;
$$;

comment on function public.rascunho_segue_a_etapa() is
  'Mantem o rascunho coerente com a etapa: contato registrado pelo Andamento fecha o rascunho como enviado; fechou, nao fechou ou descartado cancela. Sem isto o rascunho ficava orfao na fila e o retorno nao era agendado.';

drop trigger if exists trg_rascunho_segue_a_etapa on public.companies;
create trigger trg_rascunho_segue_a_etapa
  after update of status on public.companies
  for each row execute function public.rascunho_segue_a_etapa();

revoke all on function public.rascunho_segue_a_etapa() from public, anon, authenticated;

-- Acerto do que ja ficou para tras (sem id fixo: vale para qualquer caso).
-- Empresa ja em contato com rascunho aberto: o contato aconteceu quando a
-- etapa mudou, entao essa e a data do envio (e o retorno conta dela).
update public.outreach_messages m
   set status = 'sent', sent_at = c.updated_at
  from public.companies c
 where c.id = m.company_id
   and c.workspace_id = m.workspace_id
   and c.status in ('contacted', 'responded', 'meeting_scheduled')
   and m.status = 'draft'
   and m.sent_at is null;

update public.outreach_messages m
   set status = 'cancelled'
  from public.companies c
 where c.id = m.company_id
   and c.workspace_id = m.workspace_id
   and c.status in ('won', 'lost', 'rejected')
   and m.status = 'draft'
   and m.sent_at is null;
