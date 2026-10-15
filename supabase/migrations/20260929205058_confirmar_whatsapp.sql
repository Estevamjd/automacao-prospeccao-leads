-- 29/09 (painel em 4 passos): "Testar WhatsApp no fixo".
--
-- Muita empresa pequena usa WhatsApp Business no numero fixo. O painel abre
-- wa.me com o fixo; o Estevam ve se a conversa abre e confirma aqui.
--   - tem WhatsApp  -> signals.has_whatsapp = true  -> canal vira 'whatsapp'
--   - nao tem       -> signals.has_whatsapp = false -> continua 'phone'
-- Se o canal mudou e a empresa ainda nao foi contatada, o rascunho aberto
-- (escrito para ligacao) e cancelado e a analise volta para a fila: a
-- mensagem e refeita para o WhatsApp. Mesmo comportamento de mesclar_empresa.
-- A confirmacao fica em manual_overrides, como os outros dados conferidos
-- a mao, com quem confirmou e quando.

create or replace function public.confirmar_whatsapp(p_company uuid, p_tem boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c       public.companies;
  sinais  jsonb;
  antes   text;
  depois  text;
  refeita boolean := false;
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

  sinais := coalesce(c.signals, '{}'::jsonb);
  antes  := public.canal_de_abordagem(c.main_phone, c.main_email, sinais);
  sinais := sinais || jsonb_build_object('has_whatsapp', p_tem,
                                         'has_any_contact', p_tem or c.main_phone is not null or c.main_email is not null);
  depois := public.canal_de_abordagem(c.main_phone, c.main_email, sinais);

  update public.companies set
    signals = sinais,
    manual_overrides = coalesce(manual_overrides, '{}'::jsonb) || jsonb_build_object('has_whatsapp', jsonb_build_object(
      'original', c.signals->'has_whatsapp', 'valor', p_tem, 'confirmed_at', now(), 'confirmed_by', auth.uid()))
  where id = c.id;

  if depois <> antes and c.status in ('new', 'researching', 'qualified', 'ready_for_outreach', 'rejected') then
    update public.outreach_messages set status = 'cancelled'
     where company_id = c.id and status = 'draft' and sent_at is null;
    perform public.enfileirar_tarefa(c.workspace_id, c.id, 'analyze_company', 70,
                                     jsonb_build_object('motivo', 'whatsapp_confirmado'));
    refeita := true;
  end if;

  return jsonb_build_object('canal', depois, 'mensagem_refeita', refeita);
end;
$$;

revoke all on function public.confirmar_whatsapp(uuid, boolean) from public, anon;
grant execute on function public.confirmar_whatsapp(uuid, boolean) to authenticated;
