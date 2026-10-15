-- Reconstruido a partir do que o Supabase registrou em
-- supabase_migrations.schema_migrations, versao 20260823050059.
-- O arquivo nao existia no repositorio: a migracao foi aplicada direto no
-- projeto e o historico local ficou sem ela.
--
-- NOTA DE PROJETO: este indice unico foi DESFEITO depois, na migracao
-- 20260826201011 (hardening). Dominio nao e identidade: tres unidades da mesma
-- rede compartilham o mesmo site e o lote inteiro quebrava na importacao.
-- O arquivo fica aqui so para o historico local bater com o remoto.

drop index if exists public.companies_workspace_domain_uidx;
create unique index companies_workspace_domain_uidx on public.companies(workspace_id, domain);
