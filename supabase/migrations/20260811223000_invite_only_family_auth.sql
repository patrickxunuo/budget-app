-- GH-3: invite-only authentication and atomic family membership lifecycle.

-- Profiles become durable, anonymizable family-history actors. Authentication
-- identities can therefore be deleted without erasing Family-scoped history.
alter table public.profiles drop constraint profiles_id_fkey;

create table public.recent_auth_confirmations (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  confirmed_at timestamptz not null default now()
);
alter table public.recent_auth_confirmations enable row level security;
revoke all on public.recent_auth_confirmations from public, anon, authenticated;
grant all on public.recent_auth_confirmations to service_role;

-- This durable outbox survives workspace/profile deletion and allows an
-- administrator or retry worker to finish cross-system Auth identity deletion.
create table public.auth_deletion_queue (
  auth_user_id uuid primary key,
  reason text not null check (reason in ('account_deletion', 'workspace_deletion', 'orphaned_auth_identity')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.auth_deletion_queue enable row level security;
revoke all on public.auth_deletion_queue from public, anon, authenticated;
grant all on public.auth_deletion_queue to service_role;

create or replace function private.require_recent_confirmation(p_profile_id uuid)
returns void language plpgsql stable security definer set search_path = pg_catalog, private as $$
begin
  if p_profile_id is distinct from auth.uid() or not exists (
    select 1 from public.recent_auth_confirmations c
    where c.profile_id = p_profile_id and c.confirmed_at > now() - interval '15 minutes'
  ) then
    raise exception using errcode='42501', message='recent password confirmation required';
  end if;
end; $$;

create or replace function private.protect_active_owner()
returns trigger language plpgsql security definer set search_path = pg_catalog, private as $$
declare workspace_owner_id uuid;
begin
  if current_setting('app.ownership_transfer', true) = 'on' then
    return case when tg_op='DELETE' then old else new end;
  end if;
  if tg_op <> 'DELETE' and new.role='owner' and new.status='active' then
    select w.owner_profile_id into workspace_owner_id from public.workspaces w where w.id=new.workspace_id;
    if workspace_owner_id is distinct from new.profile_id then
      raise exception using errcode='23514', constraint='workspace_memberships_owner_matches_workspace', message='the active owner membership must match workspaces.owner_profile_id';
    end if;
  end if;
  if old.role='owner' and old.status='active' and (tg_op='DELETE' or new.role<>'owner' or new.status<>'active')
    and not exists(select 1 from public.workspace_memberships m where m.workspace_id=old.workspace_id and m.id<>old.id and m.role='owner' and m.status='active')
  then
    raise exception using errcode='23514', constraint='workspace_memberships_last_active_owner', message='a workspace must retain one active owner';
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;

create or replace function private.cleanup_member(p_workspace_id uuid, p_profile_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, private as $$
begin
  delete from public.audit_events where workspace_id=p_workspace_id and scope='personal' and owner_profile_id=p_profile_id;
  delete from public.transaction_metadata where workspace_id=p_workspace_id and scope='personal' and owner_profile_id=p_profile_id;
  delete from public.manual_entries where workspace_id=p_workspace_id and scope='personal' and owner_profile_id=p_profile_id;
  delete from public.merchant_rules where workspace_id=p_workspace_id and scope='personal' and owner_profile_id=p_profile_id;
  delete from public.budgets where workspace_id=p_workspace_id and scope='personal' and owner_profile_id=p_profile_id;
  delete from public.categories where workspace_id=p_workspace_id and scope='personal' and owner_profile_id=p_profile_id;
  delete from public.transactions where account_id in (select id from public.accounts where workspace_id=p_workspace_id and scope='personal' and owner_profile_id=p_profile_id);
  delete from public.accounts where workspace_id=p_workspace_id and scope='personal' and owner_profile_id=p_profile_id;
  update public.accounts set archived_at=coalesce(archived_at,now()) where workspace_id=p_workspace_id and linked_by=p_profile_id;
  update public.plaid_items set status='revoked', archived_at=coalesce(archived_at,now()) where workspace_id=p_workspace_id and linked_by=p_profile_id;
end; $$;

-- Setup is callable only with the service-role key. The explicit identity must
-- already exist in Auth and is verified against its email before any DB write.
create or replace function public.setup_family(
  p_user_id uuid,
  p_email text,
  p_display_name text,
  p_workspace_name text
)
returns uuid language plpgsql security definer set search_path = pg_catalog as $$
declare v_workspace uuid;
begin
  if not exists (
    select 1 from auth.users u
    where u.id=p_user_id and lower(u.email)=lower(trim(p_email))
  ) then raise exception using errcode='42501', message='invalid setup identity'; end if;
  perform pg_advisory_xact_lock(371903);
  if exists(select 1 from public.workspaces) then
    raise exception using errcode='P0001', message='setup closed';
  end if;
  insert into public.profiles(id,display_name) values(p_user_id,trim(p_display_name));
  insert into public.workspaces(name,owner_profile_id) values(trim(p_workspace_name),p_user_id) returning id into v_workspace;
  insert into public.workspace_memberships(workspace_id,profile_id,role,status) values(v_workspace,p_user_id,'owner','active');
  return v_workspace;
exception when unique_violation then
  raise exception using errcode='P0001', message='setup closed';
end; $$;

-- Only trusted server code may record confirmation, after it has independently
-- reauthenticated the supplied identity with Supabase Auth.
create or replace function public.mark_recent_password_confirmation(p_profile_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog as $$
begin
  if not exists (select 1 from public.profiles p where p.id=p_profile_id) then
    raise exception using errcode='22023', message='invalid profile';
  end if;
  insert into public.recent_auth_confirmations(profile_id,confirmed_at)
  values(p_profile_id,now())
  on conflict(profile_id) do update set confirmed_at=excluded.confirmed_at;
end; $$;

create or replace function public.create_invitation(p_email text, p_token_hash text, p_expires_at timestamptz)
returns table(invitation_id uuid, expires_at timestamptz) language plpgsql security definer set search_path = pg_catalog as $$
declare v_workspace uuid;
begin
  select m.workspace_id into v_workspace from public.workspace_memberships m where m.profile_id=auth.uid() and m.role='owner' and m.status='active';
  if v_workspace is null then raise exception using errcode='42501', message='forbidden'; end if;
  if p_expires_at<=now() or p_expires_at>now()+interval '168 hours' then raise exception using errcode='22023', message='invalid expiry'; end if;
  return query insert into public.invitations(workspace_id,email,invited_by,token_hash,expires_at) values(v_workspace,lower(trim(p_email)),auth.uid(),p_token_hash,p_expires_at) returning id,public.invitations.expires_at;
end; $$;

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog as $$
begin
  update public.invitations i set revoked_at=now() where i.id=p_invitation_id and i.accepted_at is null and i.revoked_at is null and private.is_active_owner(i.workspace_id);
  if not found then raise exception using errcode='P0002', message='invitation unavailable'; end if;
end; $$;

-- Invitation finalization is likewise service-role only. Public Auth signup is
-- disabled, so possession of a token cannot create a bypass account directly.
create or replace function public.accept_invitation(
  p_user_id uuid,
  p_email text,
  p_token_hash text,
  p_display_name text
)
returns uuid language plpgsql security definer set search_path = pg_catalog as $$
declare v_inv public.invitations%rowtype;
begin
  lock table public.workspace_memberships in share row exclusive mode;
  if not exists (
    select 1 from auth.users u
    where u.id=p_user_id and lower(u.email)=lower(trim(p_email))
  ) then raise exception using errcode='42501', message='invalid invitation'; end if;
  select * into v_inv from public.invitations i
  where i.token_hash=p_token_hash and i.email=lower(trim(p_email))
    and i.accepted_at is null and i.revoked_at is null and i.expires_at>now()
  for update;
  if not found then raise exception using errcode='P0001', message='invalid invitation'; end if;
  insert into public.profiles(id,display_name) values(p_user_id,trim(p_display_name));
  insert into public.workspace_memberships(workspace_id,profile_id,role,status,invited_by)
  values(v_inv.workspace_id,p_user_id,'member','active',v_inv.invited_by);
  update public.invitations set accepted_at=now() where id=v_inv.id;
  return v_inv.workspace_id;
end; $$;

create or replace function public.transfer_ownership(p_membership_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare v_current public.workspace_memberships%rowtype; v_target public.workspace_memberships%rowtype;
begin
  select * into v_current from public.workspace_memberships where profile_id=auth.uid() and role='owner' and status='active' for update;
  if not found then raise exception using errcode='42501', message='forbidden'; end if;
  perform private.require_recent_confirmation(auth.uid());
  select * into v_target from public.workspace_memberships where id=p_membership_id and workspace_id=v_current.workspace_id and role='member' and status='active' for update;
  if not found then raise exception using errcode='22023', message='invalid target'; end if;
  perform set_config('app.ownership_transfer','on',true);
  update public.workspace_memberships set role='member' where id=v_current.id;
  update public.workspace_memberships set role='owner' where id=v_target.id;
  update public.workspaces set owner_profile_id=v_target.profile_id where id=v_current.workspace_id;
end; $$;

create or replace function public.leave_workspace()
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare v_member public.workspace_memberships%rowtype;
begin
  select * into v_member from public.workspace_memberships where profile_id=auth.uid() and status='active' for update;
  if not found then raise exception using errcode='42501', message='forbidden'; end if;
  perform private.require_recent_confirmation(auth.uid());
  if v_member.role='owner' then raise exception using errcode='42501', message='owner must transfer first'; end if;
  update public.workspace_memberships set status='inactive' where id=v_member.id;
  perform private.cleanup_member(v_member.workspace_id,v_member.profile_id);
end; $$;

create or replace function public.remove_member(p_membership_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare v_owner public.workspace_memberships%rowtype; v_target public.workspace_memberships%rowtype;
begin
  select * into v_owner from public.workspace_memberships where profile_id=auth.uid() and role='owner' and status='active';
  if not found then raise exception using errcode='42501', message='forbidden'; end if;
  perform private.require_recent_confirmation(auth.uid());
  select * into v_target from public.workspace_memberships where id=p_membership_id and workspace_id=v_owner.workspace_id and role='member' and status='active' for update;
  if not found or v_target.profile_id=auth.uid() then raise exception using errcode='22023', message='invalid target'; end if;
  update public.workspace_memberships set status='inactive' where id=v_target.id;
  perform private.cleanup_member(v_target.workspace_id,v_target.profile_id);
end; $$;

create or replace function public.prepare_account_deletion()
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare v_member public.workspace_memberships%rowtype;
begin
  select * into v_member from public.workspace_memberships where profile_id=auth.uid() and status='active' for update;
  if not found then raise exception using errcode='42501', message='forbidden'; end if;
  perform private.require_recent_confirmation(auth.uid());
  if v_member.role='owner' then raise exception using errcode='42501', message='owner must transfer first'; end if;
  insert into public.auth_deletion_queue(auth_user_id,reason)
  values(auth.uid(),'account_deletion')
  on conflict(auth_user_id) do update set reason=excluded.reason,last_error=null,updated_at=now();
  update public.workspace_memberships set status='inactive' where id=v_member.id;
  perform private.cleanup_member(v_member.workspace_id,v_member.profile_id);
end; $$;
create or replace function public.delete_workspace(p_workspace_name text)
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare v_owner public.workspace_memberships%rowtype;
begin
  lock table public.workspace_memberships in share row exclusive mode;
  select * into v_owner from public.workspace_memberships where profile_id=auth.uid() and role='owner' and status='active' for update;
  if not found then raise exception using errcode='42501',message='forbidden'; end if;
  perform private.require_recent_confirmation(auth.uid());
  if (select name from public.workspaces where id=v_owner.workspace_id) is distinct from trim(p_workspace_name) then raise exception using errcode='22023',message='workspace name mismatch'; end if;
  if exists (
    select 1 from public.workspace_memberships
    where workspace_id=v_owner.workspace_id and profile_id<>auth.uid() and status='active'
    for update
  ) then
    raise exception using errcode='42501',message='active members remain';
  end if;

  insert into public.auth_deletion_queue(auth_user_id,reason)
  values(auth.uid(),'workspace_deletion')
  on conflict(auth_user_id) do update set reason=excluded.reason,last_error=null,updated_at=now();

  delete from public.audit_events where workspace_id=v_owner.workspace_id;
  delete from public.transaction_metadata where workspace_id=v_owner.workspace_id;
  delete from public.manual_entries where workspace_id=v_owner.workspace_id;
  delete from public.merchant_rules where workspace_id=v_owner.workspace_id;
  delete from public.budgets where workspace_id=v_owner.workspace_id;
  delete from public.categories where workspace_id=v_owner.workspace_id;
  delete from public.sync_state where plaid_item_id in (select id from public.plaid_items where workspace_id=v_owner.workspace_id);
  delete from public.transactions where workspace_id=v_owner.workspace_id;
  delete from public.accounts where workspace_id=v_owner.workspace_id;
  delete from public.plaid_items where workspace_id=v_owner.workspace_id;
  delete from public.invitations where workspace_id=v_owner.workspace_id;
  perform set_config('app.ownership_transfer','on',true);
  delete from public.workspace_memberships where workspace_id=v_owner.workspace_id;
  delete from public.workspaces where id=v_owner.workspace_id;
  delete from public.profiles where id=auth.uid();
end; $$;

revoke all on function public.setup_family(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.mark_recent_password_confirmation(uuid) from public,anon,authenticated;
revoke all on function public.accept_invitation(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.setup_family(uuid,text,text,text) to service_role;
grant execute on function public.mark_recent_password_confirmation(uuid) to service_role;
grant execute on function public.accept_invitation(uuid,text,text,text) to service_role;

revoke all on function public.create_invitation(text,text,timestamptz), public.revoke_invitation(uuid), public.transfer_ownership(uuid), public.leave_workspace(), public.remove_member(uuid), public.prepare_account_deletion(), public.delete_workspace(text) from public,anon;
grant execute on function public.create_invitation(text,text,timestamptz), public.revoke_invitation(uuid), public.transfer_ownership(uuid), public.leave_workspace(), public.remove_member(uuid), public.prepare_account_deletion(), public.delete_workspace(text) to authenticated;

-- Membership and invitation lifecycle writes must pass through the guarded
-- functions above. GH-2's broader table grants predated recent confirmation.
revoke insert, update, delete on public.workspace_memberships from authenticated;
revoke insert, update, delete on public.invitations from authenticated;

revoke all on function private.require_recent_confirmation(uuid), private.cleanup_member(uuid,uuid) from public,anon,authenticated;
