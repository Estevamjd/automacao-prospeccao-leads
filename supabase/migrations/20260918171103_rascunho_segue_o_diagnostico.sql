-- Mensagem escrita a partir de um diagnostico que deixou de valer nao pode
-- continuar na fila de envio.
--
-- O CAMINHO QUE LEVA A ISSO: voce abre a ficha, confere e corrige telefone,
-- site ou Instagram. salvar_dados_empresa zera o advisor_brief de proposito
-- (o diagnostico foi feito com dado errado), devolve a empresa para
-- 'researching' e enfileira nova analise.
--
-- O PROBLEMA: o rascunho antigo continuava aberto. E o rules-runner agora tem
-- uma trava que NAO escreve outro rascunho quando ja existe um aberto — trava
-- que existe por um bom motivo (evitar duplicatas a cada passada da esteira),
-- mas que, somada a isto, faria voce enviar a mensagem escrita com o dado que
-- voce acabou de corrigir. O pior tipo de defeito: silencioso e plausivel.
--
-- Hoje isso ainda nao aconteceu em producao porque a trava esta no repositorio
-- e nao na funcao publicada (rules-runner v13). Ou seja: esta migracao fecha o
-- buraco ANTES do proximo deploy abri-lo.
--
-- O gatilho olha o advisor_brief virando nulo, e nao o manual_overrides, de
-- proposito: o sinal certo e "o diagnostico que gerou este texto deixou de
-- existir", venha de onde vier.

create or replace function public.cancelar_rascunho_sem_diagnostico()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.advisor_brief is not null and new.advisor_brief is null then
    update public.outreach_messages
       set status = 'cancelled'
     where company_id = new.id
       and status = 'draft'
       and sent_at is null;
  end if;

  return null;
end;
$$;

comment on function public.cancelar_rascunho_sem_diagnostico() is
  'Cancela rascunho aberto quando o diagnostico da empresa e invalidado (ex.: dados confirmados a mao). Sem isto, a trava anti-duplicata do rules-runner preservaria um texto escrito com dado errado.';

drop trigger if exists trg_cancelar_rascunho_sem_diagnostico on public.companies;
create trigger trg_cancelar_rascunho_sem_diagnostico
  after update on public.companies
  for each row execute function public.cancelar_rascunho_sem_diagnostico();

revoke all on function public.cancelar_rascunho_sem_diagnostico() from public, anon, authenticated;
