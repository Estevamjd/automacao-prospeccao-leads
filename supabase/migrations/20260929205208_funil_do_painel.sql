-- 29/09 (painel em 4 passos): numeros dos passos numa chamada so.
--
-- O painel novo mostra, em cada passo, quantas empresas estao ali: a
-- qualificar por canal, mensagens prontas por canal, enviadas hoje, o funil
-- e as ultimas buscas. Contar no navegador exigiria baixar a base inteira;
-- aqui e uma consulta agrupada. SECURITY INVOKER: o RLS de cada tabela
-- decide o que o usuario ve (quem nao e do workspace recebe tudo zerado).

create or replace function public.funil_painel(p_workspace uuid)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    -- empresas por etapa (sem quem pediu para sair, que aparece a parte)
    'etapas', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
                 select c.status, count(*) n from public.companies c
                  where c.workspace_id = p_workspace and c.opt_out_at is null group by 1) s),
    -- ainda nao contatadas, por canal indicado
    'canais', (select coalesce(jsonb_object_agg(canal, n), '{}'::jsonb) from (
                 select e.canal, count(*) n from public.empresas_painel e
                  where e.workspace_id = p_workspace and e.opt_out_at is null
                    and e.status in ('new', 'researching', 'qualified', 'ready_for_outreach') group by 1) s),
    -- mensagens prontas (rascunhos) por canal
    'rascunhos', (select coalesce(jsonb_object_agg(channel, n), '{}'::jsonb) from (
                 select m.channel, count(*) n from public.outreach_messages m
                  where m.workspace_id = p_workspace and m.status = 'draft' and m.sent_at is null group by 1) s),
    'enviadas_hoje', (select count(*) from public.outreach_messages m
                       where m.workspace_id = p_workspace
                         and m.sent_at >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')),
    'enviadas_total', (select count(*) from public.outreach_messages m where m.workspace_id = p_workspace and m.sent_at is not null),
    'responderam', (select count(*) from public.outreach_messages m where m.workspace_id = p_workspace and m.replied_at is not null),
    'propostas', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
                 select p.status, count(*) n from public.propostas p where p.workspace_id = p_workspace group by 1) s),
    'nao_contatar', (select count(*) from public.companies c where c.workspace_id = p_workspace and c.opt_out_at is not null),
    -- ultimas buscas e quantas empresas novas cada uma trouxe
    'buscas', (select coalesce(jsonb_agg(b order by b.criada_em desc), '[]'::jsonb) from (
                 select l.name as nome, l.created_at as criada_em,
                        (select count(*) from public.companies c where c.source_id = l.id) as trazidas
                   from public.lead_sources l where l.workspace_id = p_workspace
                  order by l.created_at desc limit 5) b)
  );
$$;

revoke all on function public.funil_painel(uuid) from public, anon;
grant execute on function public.funil_painel(uuid) to authenticated;
