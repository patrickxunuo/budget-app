-- GH-5: atomic, cursor-based Plaid transaction synchronization.
alter table public.transactions
  add column pending_transaction_id text,
  add column removed_at timestamptz;

create index transactions_pending_provider_idx
  on public.transactions (pending_transaction_id)
  where pending_transaction_id is not null and removed_at is null;

alter table public.sync_state
  add column current_request_id uuid,
  add column current_trigger text,
  add column claim_started_at timestamptz,
  add column next_retry_at timestamptz,
  add column consecutive_failures integer not null default 0,
  add column needs_login_repair boolean not null default false,
  add column consent_expires_at timestamptz,
  add column provider_request_id text,
  add column last_failure_at timestamptz,
  add column last_failure_request_id uuid,
  add constraint sync_state_trigger_allowed
    check (current_trigger is null or current_trigger in ('activation', 'member', 'webhook', 'nightly')),
  add constraint sync_state_claim_consistent check (
    (status = 'running' and current_request_id is not null and claim_started_at is not null and current_trigger is not null)
    or (status <> 'running' and current_request_id is null and claim_started_at is null and current_trigger is null)
  ),
  add constraint sync_state_failures_nonnegative check (consecutive_failures >= 0);

create or replace function public.claim_plaid_sync(
  p_item_id uuid,
  p_request_id uuid,
  p_trigger text,
  p_workspace_id uuid default null,
  p_profile_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_item public.plaid_items%rowtype;
  v_state public.sync_state%rowtype;
begin
  if p_trigger not in ('activation', 'member', 'webhook', 'nightly') then
    raise exception using errcode = '22023', message = 'invalid sync trigger';
  end if;

  select * into v_item from public.plaid_items where id = p_item_id for update;
  if not found or v_item.status <> 'active' or v_item.archived_at is not null then
    raise exception using errcode = 'P0002', message = 'item unavailable';
  end if;
  if p_workspace_id is not null and (
    v_item.workspace_id is distinct from p_workspace_id or
    v_item.linked_by is distinct from p_profile_id or
    not exists (
      select 1 from public.workspace_memberships m
      where m.workspace_id = p_workspace_id and m.profile_id = p_profile_id and m.status = 'active'
    )
  ) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  insert into public.sync_state (plaid_item_id) values (p_item_id)
  on conflict (plaid_item_id) do nothing;
  select * into v_state from public.sync_state where plaid_item_id = p_item_id for update;

  if v_state.status = 'running' and v_state.claim_started_at > now() - interval '15 minutes' then
    raise exception using errcode = '55P03', message = 'sync in progress';
  end if;
  if v_state.next_retry_at is not null and v_state.next_retry_at > now() and p_trigger in ('webhook', 'nightly') then
    raise exception using errcode = '55000', message = 'retry not due';
  end if;

  update public.sync_state set
    status = 'running', current_request_id = p_request_id, current_trigger = p_trigger,
    claim_started_at = now(), last_attempt_at = now(), error_code = null, error_message = null
  where plaid_item_id = p_item_id;

  return jsonb_build_object(
    'itemId', v_item.id, 'workspaceId', v_item.workspace_id, 'linkedBy', v_item.linked_by,
    'accessTokenCiphertext', encode(v_item.access_token_ciphertext, 'hex'),
    'cursor', v_state.cursor, 'institutionName', v_item.institution_name
  );
end;
$$;

create or replace function public.commit_plaid_sync(
  p_item_id uuid,
  p_request_id uuid,
  p_original_cursor text,
  p_final_cursor text,
  p_provider_request_id text,
  p_added jsonb,
  p_modified jsonb,
  p_removed jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_item public.plaid_items%rowtype;
  v_state public.sync_state%rowtype;
  v_tx jsonb;
  v_provider_id text;
  v_pending_id text;
  v_account_id uuid;
  v_workspace_id uuid;
  v_added integer := 0;
  v_modified integer := 0;
  v_removed integer := 0;
  v_now timestamptz := now();
begin
  if jsonb_typeof(p_added) <> 'array' or jsonb_typeof(p_modified) <> 'array' or jsonb_typeof(p_removed) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid sync payload';
  end if;
  select * into v_item from public.plaid_items where id = p_item_id for update;
  if not found or v_item.status <> 'active' or v_item.archived_at is not null then
    raise exception using errcode = '55000', message = 'item unavailable';
  end if;
  select * into v_state from public.sync_state where plaid_item_id = p_item_id for update;
  if not found or v_state.status <> 'running' or v_state.current_request_id is distinct from p_request_id then
    raise exception using errcode = '40001', message = 'sync claim lost';
  end if;
  if v_state.cursor is distinct from p_original_cursor then
    raise exception using errcode = '40001', message = 'sync cursor changed';
  end if;

  for v_tx in select value from jsonb_array_elements(p_added) loop
    v_provider_id := v_tx->>'transactionId';
    select a.id, a.workspace_id into v_account_id, v_workspace_id
    from public.accounts a
    where a.plaid_item_id = p_item_id and a.provider_account_id = v_tx->>'accountId'
      and a.archived_at is null;
    if not found then raise exception using errcode = '42501', message = 'unknown item account'; end if;
    if exists (select 1 from public.transactions t where t.plaid_transaction_id = v_provider_id and t.account_id <> v_account_id) then
      raise exception using errcode = '42501', message = 'foreign transaction identity';
    end if;

    insert into public.transactions (
      workspace_id, account_id, plaid_transaction_id, amount, currency_code,
      authorized_date, transaction_date, merchant_name, name, pending,
      pending_transaction_id, provider_payload, removed_at
    ) values (
      v_workspace_id, v_account_id, v_provider_id, (v_tx->>'amount')::numeric,
      coalesce(v_tx->>'currencyCode', 'CAD'), nullif(v_tx->>'authorizedDate', '')::date,
      (v_tx->>'date')::date, nullif(v_tx->>'merchantName', ''), v_tx->>'name',
      coalesce((v_tx->>'pending')::boolean, false), nullif(v_tx->>'pendingTransactionId', ''),
      coalesce(v_tx->'payload', '{}'::jsonb), null
    ) on conflict (plaid_transaction_id) do update set
      amount = excluded.amount, currency_code = excluded.currency_code,
      authorized_date = excluded.authorized_date, transaction_date = excluded.transaction_date,
      merchant_name = excluded.merchant_name, name = excluded.name, pending = excluded.pending,
      pending_transaction_id = excluded.pending_transaction_id, provider_payload = excluded.provider_payload,
      removed_at = null, updated_at = v_now;
    if coalesce((v_tx->>'pending')::boolean, false) and exists (
      select 1 from public.transactions posted
      where posted.pending_transaction_id = v_provider_id
        and posted.account_id = v_account_id
        and posted.removed_at is null
    ) then
      update public.transactions set removed_at = v_now, updated_at = v_now
      where plaid_transaction_id = v_provider_id and account_id = v_account_id;
    end if;
    v_added := v_added + 1;
  end loop;

  for v_tx in select value from jsonb_array_elements(p_modified) loop
    v_provider_id := v_tx->>'transactionId';
    select a.id, a.workspace_id into v_account_id, v_workspace_id
    from public.accounts a
    where a.plaid_item_id = p_item_id and a.provider_account_id = v_tx->>'accountId'
      and a.archived_at is null;
    if not found then raise exception using errcode = '42501', message = 'unknown item account'; end if;
    if exists (select 1 from public.transactions t where t.plaid_transaction_id = v_provider_id and t.account_id <> v_account_id) then
      raise exception using errcode = '42501', message = 'foreign transaction identity';
    end if;

    insert into public.transactions (
      workspace_id, account_id, plaid_transaction_id, amount, currency_code,
      authorized_date, transaction_date, merchant_name, name, pending,
      pending_transaction_id, provider_payload, removed_at
    ) values (
      v_workspace_id, v_account_id, v_provider_id, (v_tx->>'amount')::numeric,
      coalesce(v_tx->>'currencyCode', 'CAD'), nullif(v_tx->>'authorizedDate', '')::date,
      (v_tx->>'date')::date, nullif(v_tx->>'merchantName', ''), v_tx->>'name',
      coalesce((v_tx->>'pending')::boolean, false), nullif(v_tx->>'pendingTransactionId', ''),
      coalesce(v_tx->'payload', '{}'::jsonb), null
    ) on conflict (plaid_transaction_id) do update set
      amount = excluded.amount, currency_code = excluded.currency_code,
      authorized_date = excluded.authorized_date, transaction_date = excluded.transaction_date,
      merchant_name = excluded.merchant_name, name = excluded.name, pending = excluded.pending,
      pending_transaction_id = excluded.pending_transaction_id, provider_payload = excluded.provider_payload,
      removed_at = null, updated_at = v_now;
    if coalesce((v_tx->>'pending')::boolean, false) and exists (
      select 1 from public.transactions posted
      where posted.pending_transaction_id = v_provider_id
        and posted.account_id = v_account_id
        and posted.removed_at is null
    ) then
      update public.transactions set removed_at = v_now, updated_at = v_now
      where plaid_transaction_id = v_provider_id and account_id = v_account_id;
    end if;
    v_modified := v_modified + 1;
  end loop;

  -- Reconcile pending predecessors only after every added/modified upsert. A
  -- predecessor may itself appear later in either input array, so doing this
  -- inline would make the final state depend on provider ordering.
  for v_tx in
    select distinct value
    from jsonb_array_elements(p_added || p_modified)
    where nullif(value->>'pendingTransactionId', '') is not null
  loop
    v_pending_id := v_tx->>'pendingTransactionId';
    select a.id into v_account_id
    from public.accounts a
    where a.plaid_item_id = p_item_id
      and a.provider_account_id = v_tx->>'accountId'
      and a.archived_at is null;
    if not found then
      raise exception using errcode = '42501', message = 'unknown item account';
    end if;
    update public.transactions set removed_at = v_now, updated_at = v_now
    where plaid_transaction_id = v_pending_id
      and account_id = v_account_id
      and removed_at is null;
  end loop;

  for v_provider_id in select value #>> '{}' from jsonb_array_elements(p_removed) loop
    update public.transactions t set removed_at = v_now, updated_at = v_now
    where t.plaid_transaction_id = v_provider_id and t.removed_at is null
      and exists (select 1 from public.accounts a where a.id = t.account_id and a.plaid_item_id = p_item_id);
    v_removed := v_removed + case when found then 1 else 0 end;
  end loop;

  update public.sync_state set
    cursor = p_final_cursor, status = 'succeeded', provider_request_id = p_provider_request_id,
    last_success_at = v_now, next_retry_at = null, consecutive_failures = 0,
    error_code = null, error_message = null, current_request_id = null,
    current_trigger = null, claim_started_at = null
  where plaid_item_id = p_item_id;

  return jsonb_build_object('added', v_added, 'modified', v_modified, 'removed', v_removed, 'lastSuccessAt', v_now);
end;
$$;

create or replace function public.fail_plaid_sync(
  p_item_id uuid, p_request_id uuid, p_error_code text, p_error_message text,
  p_needs_login_repair boolean default false,
  p_provider_request_id text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_failures integer;
begin
  select consecutive_failures + 1 into v_failures from public.sync_state
  where plaid_item_id = p_item_id and current_request_id = p_request_id for update;
  if not found then return; end if;
  update public.sync_state set
    status = 'failed', consecutive_failures = v_failures,
    last_failure_at = now(), last_failure_request_id = p_request_id,
    provider_request_id = left(p_provider_request_id, 200),
    next_retry_at = now() + make_interval(secs => least(21600, 60 * (2 ^ least(v_failures - 1, 8))))::interval,
    error_code = left(p_error_code, 80), error_message = left(p_error_message, 240),
    needs_login_repair = needs_login_repair or p_needs_login_repair,
    current_request_id = null, current_trigger = null, claim_started_at = null
  where plaid_item_id = p_item_id;
end;
$$;

revoke all on function public.claim_plaid_sync(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.commit_plaid_sync(uuid, uuid, text, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.fail_plaid_sync(uuid, uuid, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.claim_plaid_sync(uuid, uuid, text, uuid, uuid) to service_role;
grant execute on function public.commit_plaid_sync(uuid, uuid, text, text, text, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.fail_plaid_sync(uuid, uuid, text, text, boolean, text) to service_role;

-- Direct table mutation remains service-only; members receive sanitized status
-- through the authenticated route after an explicit ownership check.
revoke update on public.sync_state from authenticated;



