-- Membership changes go through the owner-checked Edge Function only.
-- This also closes the old admin policy that allowed promotion to owner.
drop policy if exists "admins can create workspace members" on public.workspace_members;
drop policy if exists "admins can update workspace members" on public.workspace_members;
drop policy if exists "admins can delete workspace members" on public.workspace_members;
revoke insert, update, delete on public.workspace_members from authenticated;
