create or replace function public.geografia_reserva(p_workspace uuid)
returns table(uf text, municipio text, zona text, disponiveis bigint, com_celular bigint)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not private.is_workspace_member(p_workspace) then
    raise exception 'Acesso negado ao workspace.' using errcode = '42501';
  end if;
  return query
    select r.uf, r.municipio, r.zona, count(*),
           count(*) filter (
             where (char_length(r.telefone1) = 11 and substring(r.telefone1 from 3 for 1) = '9')
                or (char_length(r.telefone2) = 11 and substring(r.telefone2 from 3 for 1) = '9')
           )
      from public.cnpj_reserva r
     where r.workspace_id = p_workspace and r.processado_em is null
     group by 1, 2, 3;
end;
$function$;
