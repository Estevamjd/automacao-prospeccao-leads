-- Reconstruido a partir do que o Supabase registrou em
-- supabase_migrations.schema_migrations, versao 20260826201805.
--
-- O Supabase configura um DEFAULT PRIVILEGE que concede EXECUTE ao papel
-- "authenticated" em toda funcao nova criada no schema public. Por isso o
-- "revoke all from public, anon" da migracao anterior NAO bastou: a concessao a
-- authenticated e explicita, nao vem do PUBLIC.
--
-- Consequencia: claim_next_task, complete_task, fail_task e release_stale_tasks
-- sao SECURITY DEFINER (rodam como dono e ignoram o RLS) e ficaram chamaveis
-- por qualquer usuario cadastrado via /rest/v1/rpc/... com qualquer
-- workspace_id. Mesma classe de falha do achado B1.
--
-- Estas funcoes sao de uso interno das Edge Functions e do n8n, que se
-- autenticam por segredo compartilhado e usam service_role. Nenhum navegador
-- precisa chama-las.

revoke all on function public.claim_next_task(uuid, text, text[]) from public, anon, authenticated;
revoke all on function public.complete_task(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_task(uuid, text, integer, interval) from public, anon, authenticated;
revoke all on function public.release_stale_tasks(interval) from public, anon, authenticated;

grant execute on function public.claim_next_task(uuid, text, text[]) to service_role;
grant execute on function public.complete_task(uuid, jsonb) to service_role;
grant execute on function public.fail_task(uuid, text, integer, interval) to service_role;
grant execute on function public.release_stale_tasks(interval) to service_role;

-- Funcao de gatilho: nao faz sentido chamar por RPC e nao precisa ficar exposta.
revoke all on function public.preencher_source_ref() from public, anon, authenticated;

-- is_suppressed e normalize_phone_br continuam disponiveis para authenticated
-- de proposito: sao SECURITY INVOKER (respeitam o RLS) e o painel as usa para
-- checar se um lead esta na lista de supressao antes de voce abordar.
