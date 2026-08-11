-- GH-4: pending, reviewable Plaid linking with Personal-safe activation.
alter table public.accounts alter column scope set default 'personal';
alter table public.plaid_items add constraint plaid_items_link_lifecycle
  check (status in ('pending', 'active', 'error', 'revoked'));

create table public.plaid_pending_accounts (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null,
  plaid_item_id uuid not null references public.plaid_items(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  linked_by uuid not null references public.profiles(id) on delete cascade,
  provider_account_id text not null,
  name text not null,
  official_name text,
  mask text,
  type text not null,
  subtype text,
  currency_code text,
  eligible boolean not null,
  eligibility_message text,
  duplicate_account_id uuid references public.accounts(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint plaid_pending_accounts_context_fk
    foreign key (plaid_item_id, workspace_id, linked_by)
    references public.plaid_items(id, workspace_id, linked_by) on delete cascade,
  constraint plaid_pending_accounts_review_matches_item check (review_id = plaid_item_id),
  constraint plaid_pending_accounts_provider_nonempty check (length(trim(provider_account_id)) > 0),
  constraint plaid_pending_accounts_expiry_future check (expires_at > created_at),
  constraint plaid_pending_accounts_eligibility_message check (
    (eligible and eligibility_message is null) or
    (not eligible and length(trim(eligibility_message)) > 0)
  ),
  constraint plaid_pending_accounts_review_provider_unique unique (review_id, provider_account_id)
);

create index plaid_pending_accounts_review_owner_idx
  on public.plaid_pending_accounts (review_id, workspace_id, linked_by, expires_at);

alter table public.plaid_pending_accounts enable row level security;
revoke all on public.plaid_pending_accounts from public, anon, authenticated;
grant all privileges on public.plaid_pending_accounts to service_role;

create or replace function public.activate_plaid_review(
  p_review_id uuid,
  p_workspace_id uuid,
  p_profile_id uuid,
  p_accounts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_item public.plaid_items%rowtype;
  v_selection jsonb;
  v_candidate public.plaid_pending_accounts%rowtype;
  v_scope public.data_scope;
  v_kind public.account_kind;
  v_accept_duplicate boolean;
  v_duplicate public.accounts%rowtype;
  v_account_id uuid;
  v_account_ids uuid[] := array[]::uuid[];
  v_count integer;
begin
  if jsonb_typeof(p_accounts) is distinct from 'array' or jsonb_array_length(p_accounts) = 0 then
    raise exception using errcode = '22023', message = 'at least one account is required';
  end if;

  if not exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = p_workspace_id
      and m.profile_id = p_profile_id
      and m.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  select * into v_item
  from public.plaid_items i
  where i.id = p_review_id
  for update;

  if not found or v_item.workspace_id is distinct from p_workspace_id
    or v_item.linked_by is distinct from p_profile_id then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if v_item.status is distinct from 'pending'::public.plaid_item_status then
    raise exception using errcode = '22023', message = 'review is not pending';
  end if;
  if not exists (
    select 1 from public.plaid_pending_accounts p
    where p.review_id = p_review_id and p.expires_at > now()
  ) then
    raise exception using errcode = 'P0001', message = 'review expired';
  end if;

  select count(*) into v_count
  from jsonb_array_elements(p_accounts) selection;
  if v_count is distinct from (
    select count(distinct selection->>'providerAccountId')
    from jsonb_array_elements(p_accounts) selection
  ) then
    raise exception using errcode = '22023', message = 'duplicate provider account selection';
  end if;

  for v_selection in select value from jsonb_array_elements(p_accounts)
  loop
    if not (v_selection ? 'providerAccountId') or not (v_selection ? 'scope')
      or v_selection->>'scope' not in ('personal', 'family') then
      raise exception using errcode = '22023', message = 'invalid account selection';
    end if;

    select * into v_candidate
    from public.plaid_pending_accounts p
    where p.review_id = p_review_id
      and p.workspace_id = p_workspace_id
      and p.linked_by = p_profile_id
      and p.provider_account_id = v_selection->>'providerAccountId'
    for update;

    if not found then
      raise exception using errcode = '22023', message = 'unknown account selection';
    end if;
    if v_candidate.expires_at <= now() then
      raise exception using errcode = 'P0001', message = 'review expired';
    end if;
    if not v_candidate.eligible then
      raise exception using errcode = '22023', message = 'ineligible account selection';
    end if;

    v_scope := (v_selection->>'scope')::public.data_scope;
    v_accept_duplicate := coalesce((v_selection->>'acceptDuplicate')::boolean, false);
    v_kind := case
      when v_candidate.type = 'depository' and lower(coalesce(v_candidate.subtype, '')) in ('checking', 'chequing') then 'chequing'::public.account_kind
      when v_candidate.type = 'depository' and lower(coalesce(v_candidate.subtype, '')) = 'savings' then 'savings'::public.account_kind
      when v_candidate.type = 'credit' and replace(lower(coalesce(v_candidate.subtype, '')), ' ', '_') = 'credit_card' then 'credit_card'::public.account_kind
      else null
    end;
    if v_kind is null or v_candidate.currency_code is distinct from 'CAD' then
      raise exception using errcode = '22023', message = 'ineligible account selection';
    end if;

    if v_scope = 'family' then
      -- Serialize the duplicate decision across different Plaid Items. The
      -- lock key deliberately omits mask because a missing mask must collide
      -- with an otherwise matching masked account. It is transaction-scoped,
      -- so the next activation re-checks only after this insert commits.
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          p_workspace_id::text || '|' || v_item.institution_id || '|' ||
          v_candidate.type || '|' || v_kind::text || '|' ||
          trim(regexp_replace(lower(trim(v_candidate.name)), '[^a-z0-9]+', ' ', 'g')),
          0
        )
      );
      v_duplicate := null;
      select a.* into v_duplicate
      from public.accounts a
      join public.plaid_items existing_item on existing_item.id = a.plaid_item_id
      where a.workspace_id = p_workspace_id
        and a.scope = 'family'
        and a.archived_at is null
        and existing_item.status = 'active'
        and existing_item.institution_id = v_item.institution_id
        and a.type = v_candidate.type
        and a.subtype = v_kind
        -- A missing mask cannot safely prove that two otherwise identical
        -- provider accounts are distinct, so treat it conservatively.
        and (a.mask = v_candidate.mask or a.mask is null or v_candidate.mask is null)
        -- accounts.name is immutable provider identity; display_name is
        -- member-editable presentation metadata and must never affect matching.
        and trim(regexp_replace(lower(trim(a.name)), '[^a-z0-9]+', ' ', 'g')) =
            trim(regexp_replace(lower(trim(v_candidate.name)), '[^a-z0-9]+', ' ', 'g'))
      limit 1;

      if found and not v_accept_duplicate then
        raise exception using errcode = '23505', message = 'duplicate account override required';
      end if;
    end if;

    insert into public.accounts (
      workspace_id, plaid_item_id, linked_by, provider_account_id, type, subtype,
      currency_code, mask, name, display_name, scope, owner_profile_id
    ) values (
      p_workspace_id, v_item.id, p_profile_id, v_candidate.provider_account_id,
      v_candidate.type, v_kind, v_candidate.currency_code, v_candidate.mask,
      v_candidate.name, coalesce(v_candidate.official_name, v_candidate.name),
      v_scope, case when v_scope = 'personal' then p_profile_id else null end
    ) returning id into v_account_id;
    v_account_ids := array_append(v_account_ids, v_account_id);

    if v_scope = 'family' and v_duplicate.id is not null and v_accept_duplicate then
      insert into public.audit_events (
        workspace_id, actor_profile_id, action, target_type, target_id,
        scope, owner_profile_id, details
      ) values (
        p_workspace_id, p_profile_id, 'plaid.duplicate_override', 'account', v_account_id,
        'family', null,
        jsonb_build_object('existingAccountId', v_duplicate.id, 'providerAccountId', v_candidate.provider_account_id)
      );
    end if;
  end loop;

  update public.plaid_items set status = 'active' where id = v_item.id;
  delete from public.plaid_pending_accounts where review_id = p_review_id;

  return jsonb_build_object(
    'itemId', v_item.id,
    'activatedAccountIds', to_jsonb(v_account_ids)
  );
end;
$$;

revoke all on function public.activate_plaid_review(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.activate_plaid_review(uuid, uuid, uuid, jsonb) to service_role;


-- Restrict browser roles to user-facing metadata/archive edits. Lifecycle,
-- privacy scope, and ownership transitions remain service-only/RPC-only.
revoke update (status, archived_at) on public.plaid_items from authenticated;
grant update (archived_at) on public.plaid_items to authenticated;
revoke update (display_name, scope, owner_profile_id, archived_at) on public.accounts from authenticated;
grant update (display_name, archived_at) on public.accounts to authenticated;
