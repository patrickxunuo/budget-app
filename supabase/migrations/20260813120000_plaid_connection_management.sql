-- GH-11: linker-owned Plaid Item lifecycle and account privacy management.
create type public.plaid_account_lifecycle as enum ('live', 'deselected', 'disconnected');

alter table public.accounts
  add column lifecycle public.plaid_account_lifecycle not null default 'live',
  add column read_only boolean not null default false;

update public.accounts set lifecycle='deselected',read_only=true where archived_at is not null;

alter table public.accounts add constraint accounts_lifecycle_state_consistent check (
  (lifecycle = 'live' and archived_at is null and read_only = false)
  or (lifecycle in ('deselected', 'disconnected') and archived_at is not null and read_only = true)
);

alter table public.plaid_items
  add column disconnected_at timestamptz,
  add column disconnect_claim_id uuid,
  add column disconnect_claimed_at timestamptz,
  add column disconnect_claim_mode text,
  add column disconnect_claim_previous_status public.plaid_item_status,
  add column disconnect_claim_phase text,
  add column disconnect_removal_started_at timestamptz,
  add column disconnect_provider_removed_at timestamptz,
  add constraint plaid_items_disconnect_claim_consistent check (
    (disconnect_claim_id is null and disconnect_claimed_at is null and disconnect_claim_mode is null
      and disconnect_claim_previous_status is null and disconnect_claim_phase is null
      and disconnect_removal_started_at is null and disconnect_provider_removed_at is null)
    or (disconnect_claim_id is not null and disconnect_claimed_at is not null
      and disconnect_claim_mode in ('keep_history','delete_data')
      and disconnect_claim_previous_status in ('active','error')
      and disconnect_claim_phase in ('claimed','removal_started','provider_removed')
      and (disconnect_claim_phase='claimed' and disconnect_removal_started_at is null and disconnect_provider_removed_at is null
        or disconnect_claim_phase='removal_started' and disconnect_removal_started_at is not null and disconnect_provider_removed_at is null
        or disconnect_claim_phase='provider_removed' and disconnect_removal_started_at is not null and disconnect_provider_removed_at is not null))
  );

create index accounts_plaid_item_lifecycle_idx on public.accounts(plaid_item_id, lifecycle);

-- Scope changes are a coordinated two-table transition. A private marker ties
-- the temporary trigger bypass to one backend transaction and one account.
-- Authenticated callers cannot write this table, so a caller-controlled GUC is
-- never an authority boundary.
create table private.plaid_visibility_transitions (
  backend_pid integer not null,
  transaction_id bigint not null,
  account_id uuid not null,
  primary key (backend_pid, transaction_id)
);
revoke all on private.plaid_visibility_transitions from public, anon, authenticated, service_role;

create or replace function private.enforce_immutable_columns()
returns trigger language plpgsql security definer set search_path = pg_catalog, private as $$
declare immutable_column text;
begin
  foreach immutable_column in array tg_argv loop
    if (to_jsonb(new) -> immutable_column) is distinct from (to_jsonb(old) -> immutable_column) then
      if tg_table_name = 'transaction_metadata'
        and immutable_column in ('scope','owner_profile_id')
        and exists (
          select 1 from public.transactions t
          join private.plaid_visibility_transitions v on v.account_id=t.account_id
          where t.id=(to_jsonb(new)->>'transaction_id')::uuid
            and v.backend_pid=pg_backend_pid()
            and v.transaction_id=txid_current()
        ) then
        continue;
      end if;
      raise exception using errcode='23514', constraint=tg_table_name || '_' || immutable_column || '_immutable', message=format('%I.%I is immutable',tg_table_name,immutable_column);
    end if;
  end loop;
  return new;
end $$;

create or replace function private.enforce_transaction_metadata_scope()
returns trigger language plpgsql security definer set search_path = pg_catalog, private as $$
begin
  if exists (
    select 1 from public.transactions t
    join private.plaid_visibility_transitions v on v.account_id=t.account_id
    where t.id=new.transaction_id
      and v.backend_pid=pg_backend_pid()
      and v.transaction_id=txid_current()
  ) then return new; end if;
  perform private.assert_transaction_metadata_scope(new.transaction_id,new.workspace_id,new.scope,new.owner_profile_id);
  return new;
end $$;

create or replace function private.protect_account_metadata_scope()
returns trigger language plpgsql security definer set search_path = pg_catalog, private as $$
begin
  if exists (
    select 1 from private.plaid_visibility_transitions v
    where v.account_id=new.id
      and v.backend_pid=pg_backend_pid()
      and v.transaction_id=txid_current()
  ) then return new; end if;
  if (new.scope,new.owner_profile_id) is distinct from (old.scope,old.owner_profile_id)
    and exists (
      select 1 from public.transactions t join public.transaction_metadata m on m.transaction_id=t.id
      where t.account_id=new.id and (m.scope is distinct from new.scope or m.owner_profile_id is distinct from new.owner_profile_id)
    ) then
    raise exception using errcode='23514',constraint='accounts_scope_matches_transaction_metadata',message='account scope cannot strand transaction metadata in a different privacy domain';
  end if;
  return new;
end $$;
create or replace function public.change_plaid_account_visibility(
  p_item_id uuid, p_account_id uuid, p_workspace_id uuid, p_profile_id uuid,
  p_scope public.data_scope, p_acknowledge_retroactive_impact boolean
) returns void language plpgsql security definer set search_path = pg_catalog as $$
declare v_item public.plaid_items%rowtype; v_account public.accounts%rowtype;
begin
  if not coalesce(p_acknowledge_retroactive_impact, false) then
    raise exception using errcode='22023', message='retroactive acknowledgement required';
  end if;
  select * into v_item from public.plaid_items where id=p_item_id for update;
  if not found then raise exception using errcode='P0002', message='item unavailable'; end if;
  if v_item.workspace_id is distinct from p_workspace_id or v_item.linked_by is distinct from p_profile_id
    or not exists(select 1 from public.workspace_memberships where workspace_id=p_workspace_id and profile_id=p_profile_id and status='active')
  then raise exception using errcode='42501', message='forbidden'; end if;
  if v_item.status not in ('active','error') then raise exception using errcode='55000', message='item unavailable'; end if;
  select * into v_account from public.accounts where id=p_account_id and plaid_item_id=p_item_id for update;
  if not found then raise exception using errcode='P0002', message='account unavailable'; end if;
  if v_account.lifecycle <> 'live' then raise exception using errcode='55000', message='account is read only'; end if;
  if v_account.scope = p_scope then return; end if;

  insert into private.plaid_visibility_transitions(backend_pid,transaction_id,account_id)
  values(pg_backend_pid(),txid_current(),p_account_id);
  update public.transaction_metadata m set scope=p_scope,
    owner_profile_id=case when p_scope='personal' then p_profile_id else null end,
    updated_by=p_profile_id, updated_at=now()
  where m.transaction_id in (select t.id from public.transactions t where t.account_id=p_account_id);
  update public.accounts set scope=p_scope,
    owner_profile_id=case when p_scope='personal' then p_profile_id else null end
  where id=p_account_id;
  delete from private.plaid_visibility_transitions
  where backend_pid=pg_backend_pid() and transaction_id=txid_current();
  perform private.assert_transaction_metadata_scope(m.transaction_id,m.workspace_id,m.scope,m.owner_profile_id)
  from public.transaction_metadata m join public.transactions t on t.id=m.transaction_id
  where t.account_id=p_account_id;
  insert into public.audit_events(workspace_id,actor_profile_id,action,target_type,target_id,scope,owner_profile_id,details)
  values(p_workspace_id,p_profile_id,'plaid_account.visibility_changed','account',p_account_id,p_scope,
    case when p_scope='personal' then p_profile_id else null end,
    jsonb_build_object('itemId',p_item_id,'accountId',p_account_id,'oldScope',v_account.scope,'newScope',p_scope,'changedAt',now()));
end $$;

create or replace function public.reconcile_plaid_accounts(
  p_item_id uuid, p_workspace_id uuid, p_profile_id uuid, p_accounts jsonb, p_delete_ids uuid[] default '{}'
) returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare v_item public.plaid_items%rowtype; v_row jsonb; v_local public.accounts%rowtype;
  v_kind public.account_kind; v_added uuid[]='{}'; v_returned uuid[]='{}'; v_deselected uuid[]='{}'; v_delete uuid;
begin
  if jsonb_typeof(p_accounts)<>'array' then raise exception using errcode='22023',message='invalid account payload'; end if;
  select * into v_item from public.plaid_items where id=p_item_id for update;
  if not found then raise exception using errcode='P0002',message='item unavailable'; end if;
  if v_item.workspace_id is distinct from p_workspace_id or v_item.linked_by is distinct from p_profile_id
    or not exists(select 1 from public.workspace_memberships where workspace_id=p_workspace_id and profile_id=p_profile_id and status='active')
  then raise exception using errcode='42501',message='forbidden'; end if;
  if v_item.status not in ('active','error') then raise exception using errcode='55000',message='item unavailable'; end if;


  for v_row in select value from jsonb_array_elements(p_accounts) loop
    select * into v_local from public.accounts where plaid_item_id=p_item_id and provider_account_id=v_row->>'providerAccountId' for update;
    if found then
      if v_local.lifecycle='deselected' then v_returned:=array_append(v_returned,v_local.id); end if;
      update public.accounts set available_balance_cents=nullif(v_row->>'availableBalanceCents','')::bigint,
        current_balance_cents=nullif(v_row->>'currentBalanceCents','')::bigint, credit_limit_cents=nullif(v_row->>'creditLimitCents','')::bigint,
        balance_updated_at=nullif(v_row->>'balanceUpdatedAt','')::timestamptz, lifecycle='live',read_only=false,archived_at=null
      where id=v_local.id;
    elsif coalesce((v_row->>'eligible')::boolean,false) then
      v_kind:=(v_row->>'kind')::public.account_kind;
      insert into public.accounts(workspace_id,plaid_item_id,linked_by,provider_account_id,type,subtype,currency_code,mask,name,display_name,scope,owner_profile_id,
        available_balance_cents,current_balance_cents,credit_limit_cents,balance_updated_at)
      values(p_workspace_id,p_item_id,p_profile_id,v_row->>'providerAccountId',v_row->>'type',v_kind,'CAD',nullif(v_row->>'mask',''),v_row->>'name',
        coalesce(nullif(v_row->>'officialName',''),v_row->>'name'),'personal',p_profile_id,
        nullif(v_row->>'availableBalanceCents','')::bigint,nullif(v_row->>'currentBalanceCents','')::bigint,nullif(v_row->>'creditLimitCents','')::bigint,nullif(v_row->>'balanceUpdatedAt','')::timestamptz)
      returning id into v_local.id; v_added:=array_append(v_added,v_local.id);
    end if;
  end loop;

  update public.accounts set lifecycle='deselected',read_only=true,archived_at=coalesce(archived_at,now())
  where plaid_item_id=p_item_id and lifecycle='live'
    and not exists(select 1 from jsonb_array_elements(p_accounts) r where r->>'providerAccountId'=accounts.provider_account_id);
  -- Validate deletion only after the same fresh-set pass has transitioned
  -- absent accounts to deselected. IDs remain strictly scoped to this Item.
  for v_delete in select unnest(coalesce(p_delete_ids,'{}')) loop
    select * into v_local from public.accounts where id=v_delete and plaid_item_id=p_item_id and lifecycle='deselected' for update;
    if not found then raise exception using errcode='22023',message='invalid deselected account'; end if;
    delete from public.transaction_metadata where transaction_id in(select id from public.transactions where account_id=v_delete);
    delete from public.transactions where account_id=v_delete;
    delete from public.accounts where id=v_delete;
  end loop;
  select coalesce(array_agg(id),'{}'::uuid[]) into v_deselected from public.accounts where plaid_item_id=p_item_id and lifecycle='deselected';
  return jsonb_build_object('addedAccountIds',v_added,'returnedAccountIds',v_returned,'deselectedAccountIds',v_deselected);
end $$;

create or replace function public.claim_plaid_disconnect(
  p_item_id uuid,p_workspace_id uuid,p_profile_id uuid,p_mode text,p_claim_id uuid
) returns text language plpgsql security definer set search_path=pg_catalog as $$
declare v_item public.plaid_items%rowtype; v_result text := 'claimed';
begin
  if p_mode not in ('keep_history','delete_data') then raise exception using errcode='22023',message='invalid disconnect mode'; end if;
  select * into v_item from public.plaid_items where id=p_item_id for update;
  if not found then raise exception using errcode='P0002',message='item unavailable'; end if;
  if v_item.workspace_id is distinct from p_workspace_id or v_item.linked_by is distinct from p_profile_id then raise exception using errcode='42501',message='forbidden'; end if;
  if v_item.status='revoked' then return 'disconnected'; end if;
  if v_item.status not in ('active','error') then raise exception using errcode='55000',message='item unavailable'; end if;
  if v_item.disconnect_claim_id is not null then
    if v_item.disconnect_claim_phase='provider_removed' then
      if v_item.disconnect_claim_mode is distinct from p_mode then raise exception using errcode='55000',message='disconnect mode already fixed'; end if;
      v_result := 'provider_removed';
    elsif v_item.disconnect_claimed_at > now()-interval '5 minutes' then
      raise exception using errcode='55P03',message='disconnect in progress';
    end if;
  end if;
  update public.plaid_items set disconnect_claim_id=p_claim_id,disconnect_claimed_at=now(),disconnect_claim_mode=p_mode,
    disconnect_claim_previous_status=coalesce(v_item.disconnect_claim_previous_status,v_item.status),status='error',
    disconnect_claim_phase=case when v_result='provider_removed' then 'provider_removed' else 'claimed' end,
    disconnect_removal_started_at=case when v_result='provider_removed' then v_item.disconnect_removal_started_at else null end,
    disconnect_provider_removed_at=case when v_result='provider_removed' then v_item.disconnect_provider_removed_at else null end
  where id=p_item_id;
  return v_result;
end $$;

create or replace function public.begin_plaid_disconnect_removal(p_item_id uuid,p_claim_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
  update public.plaid_items set disconnect_claim_phase='removal_started',disconnect_removal_started_at=coalesce(disconnect_removal_started_at,now()),status='error'
  where id=p_item_id and disconnect_claim_id=p_claim_id and disconnect_claim_phase='claimed' and status<>'revoked';
  if not found then raise exception using errcode='40001',message='disconnect claim lost'; end if;
end $$;

create or replace function public.mark_plaid_disconnect_provider_removed(p_item_id uuid,p_claim_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
  update public.plaid_items set disconnect_claim_phase='provider_removed',disconnect_provider_removed_at=coalesce(disconnect_provider_removed_at,now()),status='error'
  where id=p_item_id and disconnect_claim_id=p_claim_id and disconnect_claim_phase='removal_started' and status<>'revoked';
  if not found then raise exception using errcode='40001',message='disconnect claim lost'; end if;
end $$;

create or replace function public.release_plaid_disconnect(p_item_id uuid,p_claim_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
  -- Only a claim that never crossed the provider boundary may restore the
  -- prior syncable state. Started/ambiguous attempts remain fail-closed/error.
  update public.plaid_items set status=disconnect_claim_previous_status,disconnect_claim_id=null,disconnect_claimed_at=null,
    disconnect_claim_mode=null,disconnect_claim_previous_status=null,disconnect_claim_phase=null,
    disconnect_removal_started_at=null,disconnect_provider_removed_at=null
  where id=p_item_id and disconnect_claim_id=p_claim_id and disconnect_claim_phase='claimed' and status<>'revoked';
end $$;

create or replace function public.finalize_plaid_disconnect(
  p_item_id uuid,p_workspace_id uuid,p_profile_id uuid,p_mode text
) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare v_item public.plaid_items%rowtype;
begin
  if p_mode not in ('keep_history','delete_data') then raise exception using errcode='22023',message='invalid disconnect mode'; end if;
  select * into v_item from public.plaid_items where id=p_item_id for update;
  if not found then raise exception using errcode='P0002',message='item unavailable'; end if;
  if v_item.workspace_id is distinct from p_workspace_id or v_item.linked_by is distinct from p_profile_id then raise exception using errcode='42501',message='forbidden'; end if;
  if v_item.status='revoked' then return; end if;
  if v_item.status not in ('active','error') then raise exception using errcode='55000',message='item unavailable'; end if;
  if v_item.disconnect_claim_phase is distinct from 'provider_removed' or v_item.disconnect_provider_removed_at is null
    or v_item.disconnect_claim_mode is distinct from p_mode then
    raise exception using errcode='55000',message='provider removal not confirmed';
  end if;
  if p_mode='delete_data' then
    delete from public.transaction_metadata where transaction_id in(select t.id from public.transactions t join public.accounts a on a.id=t.account_id where a.plaid_item_id=p_item_id);
    delete from public.transactions where account_id in(select id from public.accounts where plaid_item_id=p_item_id);
    delete from public.accounts where plaid_item_id=p_item_id;
    delete from public.sync_state where plaid_item_id=p_item_id;
  else
    update public.accounts set lifecycle='disconnected',read_only=true,archived_at=coalesce(archived_at,now()) where plaid_item_id=p_item_id;
    update public.sync_state set status='idle',cursor=null,current_request_id=null,current_trigger=null,claim_started_at=null,next_retry_at=null,
      needs_login_repair=false,error_code=null,error_message=null where plaid_item_id=p_item_id;
  end if;
  update public.plaid_items set status='revoked',archived_at=coalesce(archived_at,now()),disconnected_at=coalesce(disconnected_at,now()),
    access_token_ciphertext='\x00'::bytea,access_token_key_version=1,disconnect_claim_id=null,disconnect_claimed_at=null,
    disconnect_claim_mode=null,disconnect_claim_previous_status=null,disconnect_claim_phase=null,
    disconnect_removal_started_at=null,disconnect_provider_removed_at=null where id=p_item_id;
end $$;

create or replace function public.finalize_claimed_plaid_disconnect(
  p_item_id uuid,p_workspace_id uuid,p_profile_id uuid,p_mode text,p_claim_id uuid
) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare v_claim uuid; v_claim_mode text; v_phase text; v_status public.plaid_item_status;
begin
  select disconnect_claim_id,disconnect_claim_mode,disconnect_claim_phase,status into v_claim,v_claim_mode,v_phase,v_status
  from public.plaid_items where id=p_item_id for update;
  if not found then raise exception using errcode='P0002',message='item unavailable'; end if;
  if v_status='revoked' then return; end if;
  if v_claim is distinct from p_claim_id or v_claim_mode is distinct from p_mode then
    raise exception using errcode='40001',message='disconnect claim lost';
  end if;
  if v_phase is distinct from 'provider_removed' then
    raise exception using errcode='55000',message='provider removal not confirmed';
  end if;
  perform public.finalize_plaid_disconnect(p_item_id,p_workspace_id,p_profile_id,p_mode);
end $$;
-- Membership departure keeps already shared Family history but removes Personal history.
create or replace function private.cleanup_member(p_workspace_id uuid,p_profile_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,private as $$
begin
  delete from public.audit_events where workspace_id=p_workspace_id and scope='personal' and owner_profile_id=p_profile_id;
  delete from public.transaction_metadata where workspace_id=p_workspace_id and scope='personal' and owner_profile_id=p_profile_id;
  delete from public.manual_entries where workspace_id=p_workspace_id and scope='personal' and owner_profile_id=p_profile_id;
  delete from public.merchant_rules where workspace_id=p_workspace_id and scope='personal' and owner_profile_id=p_profile_id;
  delete from public.budgets where workspace_id=p_workspace_id and scope='personal' and owner_profile_id=p_profile_id;
  delete from public.categories where workspace_id=p_workspace_id and scope='personal' and owner_profile_id=p_profile_id;
  delete from public.transactions where account_id in(select id from public.accounts where workspace_id=p_workspace_id and scope='personal' and owner_profile_id=p_profile_id);
  delete from public.accounts where workspace_id=p_workspace_id and scope='personal' and owner_profile_id=p_profile_id;
  update public.accounts set lifecycle='disconnected',read_only=true,archived_at=coalesce(archived_at,now()) where workspace_id=p_workspace_id and linked_by=p_profile_id and scope='family';
  update public.plaid_items set status='revoked',archived_at=coalesce(archived_at,now()),disconnected_at=coalesce(disconnected_at,now()),access_token_ciphertext='\x00'::bytea where workspace_id=p_workspace_id and linked_by=p_profile_id;
end $$;

revoke all on function public.claim_plaid_disconnect(uuid,uuid,uuid,text,uuid), public.begin_plaid_disconnect_removal(uuid,uuid), public.mark_plaid_disconnect_provider_removed(uuid,uuid), public.release_plaid_disconnect(uuid,uuid), public.finalize_claimed_plaid_disconnect(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_plaid_disconnect(uuid,uuid,uuid,text,uuid), public.begin_plaid_disconnect_removal(uuid,uuid), public.mark_plaid_disconnect_provider_removed(uuid,uuid), public.release_plaid_disconnect(uuid,uuid), public.finalize_claimed_plaid_disconnect(uuid,uuid,uuid,text,uuid) to service_role;
revoke all on function public.change_plaid_account_visibility(uuid,uuid,uuid,uuid,public.data_scope,boolean), public.reconcile_plaid_accounts(uuid,uuid,uuid,jsonb,uuid[]), public.finalize_plaid_disconnect(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.change_plaid_account_visibility(uuid,uuid,uuid,uuid,public.data_scope,boolean), public.reconcile_plaid_accounts(uuid,uuid,uuid,jsonb,uuid[]), public.finalize_plaid_disconnect(uuid,uuid,uuid,text) to service_role;
