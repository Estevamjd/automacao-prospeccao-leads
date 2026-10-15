create or replace function public.concluir_retorno(p_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare f public.follow_ups;
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  update public.follow_ups set status='completed' where id=p_id and status='scheduled' returning * into f;
  if not found then raise exception 'Retorno não encontrado ou já concluído.'; end if;
  insert into public.activities(workspace_id,company_id,activity_type,title,body)
    values(f.workspace_id,f.company_id,'note','Retorno concluído',f.notes);
  update public.companies set updated_at=now() where id=f.company_id and workspace_id=f.workspace_id;
  update public.knowledge_notes set sync_status='pending' where entity_id=f.company_id and workspace_id=f.workspace_id and entity_type='company';
end;
$$;
revoke all on function public.concluir_retorno(uuid) from public,anon;
grant execute on function public.concluir_retorno(uuid) to authenticated;
