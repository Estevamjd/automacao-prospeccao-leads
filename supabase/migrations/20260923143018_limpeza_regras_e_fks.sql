-- C2 + C5 (23/09): limpeza.
--
-- C2) Instituicao militar passava no filtro de setor publico. O CEFAN
--     ("Centro de Educacao Fisica Almirante Adalberto Nunes", da Marinha)
--     chegou a "Pronto para contato" com rascunho escrito: o nome nao tem
--     "marinha" e a categoria do OpenStreetMap e sports_centre.
--     Termos novos na penalidade de nome. "almirante" sozinho ficou de FORA
--     de proposito: "Pizzaria Almirante" ou "Bar do Almirante" sao comercio
--     de verdade e levariam -60. Pelo mesmo motivo nao entram "militar" e
--     "quartel" sozinhos ("Padaria da Vila Militar", "Quartel do Chopp").
--     Os termos abaixo so aparecem em nome de instituicao.
--
-- C5) FK redundante. outreach_messages e follow_ups tinham DUAS FKs para
--     companies: a simples (company_id) e a composta (company_id,
--     workspace_id), que e a que garante mensagem e empresa no mesmo
--     workspace. Com duas, o PostgREST nao sabe qual usar no embed
--     "companies(...)" e devolve erro de ambiguidade (PGRST201) — foi o que
--     quebrou o painel em 11/09. A composta cobre tudo o que a simples
--     cobria (mesmo ON DELETE CASCADE), entao a simples sai.
--     O painel continua usando o hint explicito (!..._company_workspace_fkey),
--     que segue valido.

-- C2 -------------------------------------------------------------------------
update public.rule_sets rs
   set rules = (
         select jsonb_agg(
                  case
                    when r->>'field' = 'name'
                     and r->>'operator' = 'contains_any'
                     and (r->>'points')::numeric <= -60
                    then jsonb_set(
                           r, '{values}',
                           (select jsonb_agg(distinct v)
                              from (
                                select jsonb_array_elements_text(r->'values') as v
                                union
                                select unnest(array[
                                  'cefan',
                                  'centro de educacao fisica almirante',
                                  'base naval',
                                  'arsenal de marinha',
                                  'colegio militar',
                                  'hospital militar',
                                  'organizacao militar',
                                  'policia militar',
                                  'policia civil'
                                ])
                              ) t)
                         )
                    else r
                  end
                  order by ord)
           from jsonb_array_elements(rs.rules) with ordinality as e(r, ord)
       ),
       updated_at = now()
 where jsonb_typeof(rs.rules) = 'array'
   and exists (
         select 1 from jsonb_array_elements(rs.rules) r
          where r->>'field' = 'name'
            and r->>'operator' = 'contains_any'
            and (r->>'points')::numeric <= -60
       );

-- C5 -------------------------------------------------------------------------
-- So remove a simples se a composta existir: nunca deixar a tabela sem FK.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'outreach_messages_company_workspace_fkey'
               and conrelid = 'public.outreach_messages'::regclass) then
    alter table public.outreach_messages drop constraint if exists outreach_messages_company_id_fkey;
  end if;

  if exists (select 1 from pg_constraint where conname = 'follow_ups_company_workspace_fkey'
               and conrelid = 'public.follow_ups'::regclass) then
    alter table public.follow_ups drop constraint if exists follow_ups_company_id_fkey;
  end if;
end
$$;

-- O cascade que a FK simples fazia continua por conta da composta; o indice
-- em company_id (usado no delete em cascata) nao depende da FK e fica.
