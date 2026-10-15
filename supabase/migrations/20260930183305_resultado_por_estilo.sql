-- 30/09: qual jeito de abrir a conversa funciona melhor.
--
-- O painel guarda em companies.metadata.observacoes.estilo o jeito escolhido
-- na primeira mensagem (pesquisa, elogio, cliente, vizinho, curta). Esta
-- funcao conta, por estilo, quantas empresas ja foram contatadas e quantas
-- responderam. Mensagem sem estilo escolhido conta como "regras" (o texto
-- escrito automaticamente). SECURITY INVOKER: o RLS decide o que o usuario ve.

create or replace function public.resultado_por_estilo(p_workspace uuid)
returns table (estilo text, contatadas bigint, responderam bigint)
language sql stable security invoker set search_path = '' as $$
  select coalesce(nullif(c.metadata->'observacoes'->>'estilo', ''), 'regras') as estilo,
         count(*) as contatadas,
         count(*) filter (where c.status in ('responded', 'meeting_scheduled', 'won')) as responderam
    from public.companies c
   where c.workspace_id = p_workspace
     and c.status in ('contacted', 'responded', 'meeting_scheduled', 'won', 'lost')
   group by 1
   order by 2 desc;
$$;

revoke all on function public.resultado_por_estilo(uuid) from public, anon;
grant execute on function public.resultado_por_estilo(uuid) to authenticated;
