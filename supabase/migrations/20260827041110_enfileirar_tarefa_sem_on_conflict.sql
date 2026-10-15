-- Corrige a fila silenciosamente parada por ON CONFLICT contra indice parcial.
-- O timestamp corresponde a migracao ja aplicada no Supabase; a definicao
-- abaixo reproduz o comportamento e as permissoes verificados no banco remoto.

create or replace function public.enfileirar_tarefa(
  target_workspace_id uuid,
  target_company_id uuid,
  tipo text,
  prioridade integer default 50,
  dados jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  novo_id uuid;
begin
  insert into public.agent_tasks (workspace_id, company_id, task_type, priority, payload)
  values (target_workspace_id, target_company_id, tipo, prioridade, dados)
  returning id into novo_id;

  return novo_id;
exception
  when unique_violation then
    -- Ja existe uma tarefa pendente ou rodando do mesmo tipo para a empresa.
    return null;
end;
$$;

comment on function public.enfileirar_tarefa(uuid, uuid, text, integer, jsonb) is
  'Coloca uma tarefa na fila, ignorando quando ja existe uma pendente do mesmo tipo para a mesma empresa. Devolve o id criado ou null se ja havia.';

-- SECURITY DEFINER nunca fica exposta a usuarios do painel.
revoke all on function public.enfileirar_tarefa(uuid, uuid, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.enfileirar_tarefa(uuid, uuid, text, integer, jsonb)
  to service_role;
