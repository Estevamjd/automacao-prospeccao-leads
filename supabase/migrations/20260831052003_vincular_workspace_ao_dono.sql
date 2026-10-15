-- =============================================================================
-- Vinculo automatico do workspace ao dono, no primeiro login.
-- =============================================================================
--
-- PROBLEMA QUE ISSO RESOLVE:
-- O banco tem 70 empresas, mas workspaces.owner_id era nulo e nao havia
-- nenhum usuario. O painel usa RLS baseada em workspace_members, entao ele
-- abria vazio: os dados existiam e ninguem podia ve-los. O passo manual era
-- "criar a conta e rodar um UPDATE na mao", que e exatamente o tipo de passo
-- que a pessoa esquece e depois acha que o sistema esta quebrado.
--
-- RISCO QUE ISSO **NAO** PODE CRIAR:
-- "Adotar o primeiro usuario que aparecer" seria um buraco de seguranca real.
-- O cadastro por magic link e publico: um estranho que se cadastrasse primeiro
-- viraria dono da base inteira. Por isso o vinculo so acontece se o e-mail do
-- novo usuario for EXATAMENTE o e-mail cadastrado como dono do workspace, em
-- workspaces.settings->>'owner_email'. Qualquer outro cadastro nao ganha nada:
-- entra sem workspace e nao enxerga um byte, porque a RLS continua valendo.

create or replace function public.vincular_dono_do_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws record;
  email_novo text := lower(btrim(coalesce(new.email, '')));
begin
  if email_novo = '' then
    return new;
  end if;

  -- Procura um workspace que esteja esperando exatamente este e-mail.
  select w.id
    into ws
    from public.workspaces w
   where w.owner_id is null
     and lower(btrim(coalesce(w.settings ->> 'owner_email', ''))) = email_novo
   order by w.created_at
   limit 1;

  if not found then
    return new;
  end if;

  update public.workspaces
     set owner_id = new.id
   where id = ws.id
     and owner_id is null;   -- corrida: quem chegar depois nao sobrescreve

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws.id, new.id, 'owner')
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists trg_vincular_dono_do_workspace on auth.users;
create trigger trg_vincular_dono_do_workspace
  after insert on auth.users
  for each row execute function public.vincular_dono_do_workspace();

revoke all on function public.vincular_dono_do_workspace() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Rede de seguranca: se o usuario JA existir quando esta migracao rodar (por
-- exemplo, voce criou a conta antes), o gatilho nao dispara mais para ele.
-- Este bloco faz o vinculo retroativo, com a mesma checagem de e-mail.
-- -----------------------------------------------------------------------------
do $$
declare
  w record;
  u record;
begin
  for w in
    select id, lower(btrim(coalesce(settings ->> 'owner_email', ''))) as email_dono
      from public.workspaces
     where owner_id is null
       and coalesce(settings ->> 'owner_email', '') <> ''
  loop
    select id into u from auth.users where lower(btrim(coalesce(email, ''))) = w.email_dono limit 1;
    if found then
      update public.workspaces set owner_id = u.id where id = w.id and owner_id is null;
      insert into public.workspace_members (workspace_id, user_id, role)
      values (w.id, u.id, 'owner')
      on conflict do nothing;
    end if;
  end loop;
end
$$;
