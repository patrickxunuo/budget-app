-- GH-5: Plaid returns transactions for every account on an Item, including
-- accounts the member never linked. Raising on those aborted the entire sync
-- page, so any institution holding an unsupported or unselected account could
-- never complete a single sync and retried into the same failure forever.
-- Skip those rows and apply the rest. The 'foreign transaction identity'
-- guard is retained: it protects a real invariant.

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
    -- Plaid returns activity for every account on the Item. Accounts the
    -- member never linked are absent locally by design, so skip their rows
    -- instead of failing the page.
    if not found then continue; end if;
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
    -- Plaid returns activity for every account on the Item. Accounts the
    -- member never linked are absent locally by design, so skip their rows
    -- instead of failing the page.
    if not found then continue; end if;
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
    if not found then continue; end if;
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
