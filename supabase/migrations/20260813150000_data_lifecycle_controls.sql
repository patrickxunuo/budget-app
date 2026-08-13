-- GH-12: provider-first, retryable account/workspace lifecycle finalization.

-- Manual entries normally preserve an audit trail through soft deletion. A
-- confirmed account/workspace teardown is the narrow exception: its guarded
-- security-definer finalizer sets this transaction-local flag before cleanup.
create or replace function private.prevent_manual_entry_hard_delete()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if current_setting('app.data_lifecycle_cleanup', true) = 'on' then
    return old;
  end if;
  raise exception using errcode = '23514', message = 'manual entries must be soft deleted';
end $$;
revoke all on function private.prevent_manual_entry_hard_delete() from public, anon, authenticated;


-- Durable notification claims serialize SMTP side effects across concurrent
-- deletion requests without storing recipient addresses or mail credentials.
create table if not exists public.workspace_deletion_notifications (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  profile_id uuid not null,
  claim_id uuid,
  claimed_at timestamptz,
  sent_at timestamptz,
  primary key (workspace_id, profile_id),
  constraint workspace_deletion_notification_claim_consistent check (
    (claim_id is null and claimed_at is null) or
    (claim_id is not null and claimed_at is not null)
  )
);
alter table public.workspace_deletion_notifications enable row level security;
revoke all on public.workspace_deletion_notifications from public, anon, authenticated;
grant all on public.workspace_deletion_notifications to service_role;

create or replace function public.claim_workspace_deletion_notification(
  p_workspace_id uuid, p_profile_id uuid, p_claim_id uuid
) returns text language plpgsql security definer set search_path=pg_catalog as $$
declare v_row public.workspace_deletion_notifications%rowtype;
begin
  insert into public.workspace_deletion_notifications(workspace_id,profile_id)
  values(p_workspace_id,p_profile_id) on conflict(workspace_id,profile_id) do nothing;
  select * into v_row from public.workspace_deletion_notifications
    where workspace_id=p_workspace_id and profile_id=p_profile_id for update;
  if v_row.sent_at is not null then return 'sent'; end if;
  if v_row.claim_id is not null and v_row.claim_id is distinct from p_claim_id
     and v_row.claimed_at > now()-interval '5 minutes' then return 'busy'; end if;
  update public.workspace_deletion_notifications
    set claim_id=p_claim_id,claimed_at=now()
    where workspace_id=p_workspace_id and profile_id=p_profile_id;
  return 'claimed';
end $$;

create or replace function public.mark_workspace_deletion_notification_sent(
  p_workspace_id uuid, p_profile_id uuid, p_claim_id uuid
) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
  update public.workspace_deletion_notifications
    set sent_at=coalesce(sent_at,now()),claim_id=null,claimed_at=null
    where workspace_id=p_workspace_id and profile_id=p_profile_id
      and claim_id=p_claim_id and sent_at is null;
  if not found then
    if exists(select 1 from public.workspace_deletion_notifications where workspace_id=p_workspace_id and profile_id=p_profile_id and sent_at is not null) then return; end if;
    raise exception using errcode='40001',message='notification claim lost';
  end if;
end $$;

create or replace function public.release_workspace_deletion_notification(
  p_workspace_id uuid, p_profile_id uuid, p_claim_id uuid
) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
  update public.workspace_deletion_notifications set claim_id=null,claimed_at=null
    where workspace_id=p_workspace_id and profile_id=p_profile_id
      and claim_id=p_claim_id and sent_at is null;
end $$;

revoke all on function public.claim_workspace_deletion_notification(uuid,uuid,uuid), public.mark_workspace_deletion_notification_sent(uuid,uuid,uuid), public.release_workspace_deletion_notification(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_workspace_deletion_notification(uuid,uuid,uuid), public.mark_workspace_deletion_notification_sent(uuid,uuid,uuid), public.release_workspace_deletion_notification(uuid,uuid,uuid) to service_role;
create or replace function public.finalize_account_deletion()
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare v_member public.workspace_memberships%rowtype;
begin
  select * into v_member from public.workspace_memberships where profile_id=auth.uid() and status='active' for update;
  if not found then
    if exists(select 1 from public.auth_deletion_queue where auth_user_id=auth.uid() and reason='account_deletion') then return; end if;
    raise exception using errcode='42501',message='forbidden';
  end if;
  if v_member.role='owner' then raise exception using errcode='42501',message='forbidden'; end if;
  perform private.require_recent_confirmation(auth.uid());
  if exists(select 1 from public.plaid_items where workspace_id=v_member.workspace_id and linked_by=auth.uid() and status<>'revoked') then
    raise exception using errcode='P0001',message='provider revocation incomplete';
  end if;
  insert into public.auth_deletion_queue(auth_user_id,reason) values(auth.uid(),'account_deletion')
    on conflict(auth_user_id) do update set reason=excluded.reason,last_error=null,updated_at=now();
  perform set_config('app.data_lifecycle_cleanup','on',true);
  update public.workspace_memberships set status='inactive' where id=v_member.id;
  perform private.cleanup_member(v_member.workspace_id,v_member.profile_id);
  delete from public.recent_auth_confirmations where profile_id=v_member.profile_id;
end; $$;

drop function if exists public.finalize_workspace_deletion(text);
drop function if exists public.finalize_workspace_deletion(text,boolean);

create or replace function public.finalize_workspace_deletion(p_actor_id uuid, p_workspace_name text, p_notifications_required boolean)
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare v_owner public.workspace_memberships%rowtype; v_profiles uuid[];
begin
  lock table public.workspace_memberships in share row exclusive mode;
  select * into v_owner from public.workspace_memberships where profile_id=p_actor_id and role='owner' and status='active' for update;
  if not found then
    if exists(select 1 from public.auth_deletion_queue where auth_user_id=p_actor_id and reason='workspace_deletion') then return; end if;
    raise exception using errcode='42501',message='forbidden';
  end if;
  if not exists(select 1 from public.recent_auth_confirmations where profile_id=p_actor_id and confirmed_at > now()-interval '15 minutes') then raise exception using errcode='42501',message='recent confirmation required'; end if;
  if (select name from public.workspaces where id=v_owner.workspace_id) is distinct from trim(p_workspace_name) then raise exception using errcode='22023',message='workspace name mismatch'; end if;
  if exists(select 1 from public.plaid_items where workspace_id=v_owner.workspace_id and status<>'revoked') then raise exception using errcode='P0001',message='provider revocation incomplete'; end if;
  if p_notifications_required and exists(
    select 1 from public.workspace_memberships m
    where m.workspace_id=v_owner.workspace_id and m.status='active'
      and not exists(select 1 from public.workspace_deletion_notifications n where n.workspace_id=m.workspace_id and n.profile_id=m.profile_id and n.sent_at is not null)
  ) then raise exception using errcode='P0001',message='member notification incomplete'; end if;
  select array_agg(profile_id) into v_profiles from public.workspace_memberships where workspace_id=v_owner.workspace_id;
  insert into public.auth_deletion_queue(auth_user_id,reason)
    select unnest(v_profiles),'workspace_deletion'
    on conflict(auth_user_id) do update set reason=excluded.reason,last_error=null,updated_at=now();
  perform set_config('app.data_lifecycle_cleanup','on',true);
  delete from public.audit_events where workspace_id=v_owner.workspace_id;
  delete from public.transaction_metadata where workspace_id=v_owner.workspace_id;
  delete from public.manual_entries where workspace_id=v_owner.workspace_id;
  delete from public.merchant_rules where workspace_id=v_owner.workspace_id;
  delete from public.budgets where workspace_id=v_owner.workspace_id;
  delete from public.categories where workspace_id=v_owner.workspace_id;
  delete from public.sync_state where plaid_item_id in(select id from public.plaid_items where workspace_id=v_owner.workspace_id);
  delete from public.transactions where workspace_id=v_owner.workspace_id;
  delete from public.accounts where workspace_id=v_owner.workspace_id;
  delete from public.plaid_pending_accounts where workspace_id=v_owner.workspace_id;
  delete from public.plaid_items where workspace_id=v_owner.workspace_id;
  delete from public.invitations where workspace_id=v_owner.workspace_id;
  delete from public.workspace_deletion_notifications where workspace_id=v_owner.workspace_id;
  delete from public.recent_auth_confirmations where profile_id=any(v_profiles);
  perform set_config('app.ownership_transfer','on',true);
  delete from public.workspace_memberships where workspace_id=v_owner.workspace_id;
  delete from public.workspaces where id=v_owner.workspace_id;
  delete from public.profiles where id=any(v_profiles);
end; $$;

revoke all on function public.finalize_account_deletion() from public,anon;
grant execute on function public.finalize_account_deletion() to authenticated;
revoke all on function public.finalize_workspace_deletion(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.finalize_workspace_deletion(uuid,text,boolean) to service_role;




