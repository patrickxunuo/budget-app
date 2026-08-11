-- GH-2: family finance schema and privacy boundary.
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create type public.data_scope as enum ('family', 'personal');
create type public.membership_role as enum ('owner', 'member');
create type public.membership_status as enum ('invited', 'active', 'inactive');
create type public.plaid_item_status as enum ('active', 'error', 'revoked');
create type public.account_kind as enum ('chequing', 'savings', 'credit_card');
create type public.sync_status as enum ('idle', 'running', 'succeeded', 'failed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 100),
  avatar_url text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.workspaces (
  id uuid primary key default gen_random_uuid(), singleton_key boolean not null default true,
  name text not null check (length(trim(name)) between 1 and 100),
  owner_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint workspaces_singleton_key_true check (singleton_key),
  constraint workspaces_singleton_key_unique unique (singleton_key),
  constraint workspaces_id_owner_unique unique (id, owner_profile_id)
);
create table public.workspace_memberships (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role public.membership_role not null default 'member', status public.membership_status not null default 'invited',
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint workspace_memberships_workspace_profile_unique unique (workspace_id, profile_id)
);
create unique index workspace_memberships_one_active_owner_idx on public.workspace_memberships (workspace_id) where role = 'owner' and status = 'active';
create index workspace_memberships_profile_status_idx on public.workspace_memberships (profile_id, status, workspace_id);
create index workspace_memberships_workspace_status_idx on public.workspace_memberships (workspace_id, status, profile_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null, role public.membership_role not null default 'member',
  invited_by uuid not null references public.profiles(id) on delete restrict, token_hash text not null,
  expires_at timestamptz not null, accepted_at timestamptz, revoked_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint invitations_email_normalized check (email = lower(trim(email)) and position('@' in email) > 1),
  constraint invitations_member_role_only check (role = 'member'),
  constraint invitations_sha256_token_hash check (token_hash ~ '^[0-9a-f]{64,}$'),
  constraint invitations_resolution_exclusive check (accepted_at is null or revoked_at is null),
  constraint invitations_expiry_after_creation check (expires_at > created_at)
);
create unique index invitations_active_email_idx on public.invitations (workspace_id, email) where accepted_at is null and revoked_at is null;
create index invitations_workspace_idx on public.invitations (workspace_id, expires_at);

create table public.plaid_items (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  linked_by uuid not null references public.profiles(id) on delete restrict,
  plaid_item_id text not null, institution_id text not null, institution_name text not null,
  access_token_ciphertext bytea not null, access_token_key_version integer not null,
  status public.plaid_item_status not null default 'active', archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint plaid_items_provider_id_nonempty check (length(trim(plaid_item_id)) > 0),
  constraint plaid_items_institution_id_nonempty check (length(trim(institution_id)) > 0),
  constraint plaid_items_ciphertext_nonempty check (octet_length(access_token_ciphertext) > 0),
  constraint plaid_items_key_version_positive check (access_token_key_version > 0),
  constraint plaid_items_provider_id_unique unique (plaid_item_id),
  constraint plaid_items_id_workspace_linker_unique unique (id, workspace_id, linked_by)
);
create index plaid_items_workspace_linker_idx on public.plaid_items (workspace_id, linked_by);

create table public.accounts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, plaid_item_id uuid not null, linked_by uuid not null,
  provider_account_id text not null, type text not null, subtype public.account_kind not null,
  currency_code text not null default 'CAD', mask text, name text not null, display_name text,
  scope public.data_scope not null default 'family', owner_profile_id uuid references public.profiles(id) on delete restrict,
  archived_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint accounts_plaid_item_context_fk foreign key (plaid_item_id, workspace_id, linked_by) references public.plaid_items(id, workspace_id, linked_by) on delete restrict,
  constraint accounts_provider_id_unique unique (provider_account_id), constraint accounts_id_workspace_unique unique (id, workspace_id),
  constraint accounts_currency_cad check (currency_code = 'CAD'),
  constraint accounts_supported_type check (
    (type = 'depository' and subtype in ('chequing', 'savings'))
    or (type = 'credit' and subtype = 'credit_card')
  ),
  constraint accounts_scope_owner_consistent check ((scope = 'family' and owner_profile_id is null) or (scope = 'personal' and owner_profile_id = linked_by)),
  constraint accounts_provider_id_nonempty check (length(trim(provider_account_id)) > 0)
);
create index accounts_workspace_scope_owner_idx on public.accounts (workspace_id, scope, owner_profile_id);
create index accounts_plaid_item_idx on public.accounts (plaid_item_id);
create index accounts_linked_by_idx on public.accounts (linked_by);

create table public.transactions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, account_id uuid not null,
  plaid_transaction_id text not null, amount numeric(14, 2) not null, currency_code text not null default 'CAD',
  authorized_date date, transaction_date date not null, merchant_name text, name text not null,
  pending boolean not null default false, provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint transactions_account_context_fk foreign key (account_id, workspace_id) references public.accounts(id, workspace_id) on delete restrict,
  constraint transactions_provider_id_unique unique (plaid_transaction_id), constraint transactions_id_workspace_unique unique (id, workspace_id),
  constraint transactions_currency_cad check (currency_code = 'CAD'),
  constraint transactions_provider_id_nonempty check (length(trim(plaid_transaction_id)) > 0),
  constraint transactions_payload_object check (jsonb_typeof(provider_payload) = 'object')
);
create index transactions_account_date_idx on public.transactions (account_id, transaction_date desc);
create index transactions_workspace_date_idx on public.transactions (workspace_id, transaction_date desc);

create table public.categories (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  name text not null, color text, scope public.data_scope not null default 'family',
  owner_profile_id uuid references public.profiles(id) on delete restrict, archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint categories_id_workspace_unique unique (id, workspace_id),
  constraint categories_name_nonempty check (length(trim(name)) > 0),
  constraint categories_scope_owner_consistent check ((scope = 'family' and owner_profile_id is null) or (scope = 'personal' and owner_profile_id = created_by))
);
create unique index categories_active_family_name_idx on public.categories (workspace_id, lower(name)) where archived_at is null and scope = 'family';
create unique index categories_active_personal_name_idx on public.categories (workspace_id, owner_profile_id, lower(name)) where archived_at is null and scope = 'personal';
create index categories_workspace_scope_owner_idx on public.categories (workspace_id, scope, owner_profile_id);

create table public.transaction_metadata (
  transaction_id uuid primary key, workspace_id uuid not null,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  scope public.data_scope not null default 'family', owner_profile_id uuid references public.profiles(id) on delete restrict,
  category_id uuid, note text, excluded boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint transaction_metadata_transaction_context_fk foreign key (transaction_id, workspace_id) references public.transactions(id, workspace_id) on delete cascade,
  constraint transaction_metadata_category_context_fk foreign key (category_id, workspace_id) references public.categories(id, workspace_id) on delete restrict,
  constraint transaction_metadata_scope_owner_consistent check ((scope = 'family' and owner_profile_id is null) or (scope = 'personal' and owner_profile_id = updated_by))
);
create index transaction_metadata_workspace_scope_owner_idx on public.transaction_metadata (workspace_id, scope, owner_profile_id);
create index transaction_metadata_category_idx on public.transaction_metadata (category_id);

create table public.manual_entries (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  scope public.data_scope not null default 'family', owner_profile_id uuid references public.profiles(id) on delete restrict,
  amount numeric(14, 2) not null, currency_code text not null default 'CAD', entry_date date not null,
  description text not null, category_id uuid, archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint manual_entries_category_context_fk foreign key (category_id, workspace_id) references public.categories(id, workspace_id) on delete restrict,
  constraint manual_entries_currency_cad check (currency_code = 'CAD'),
  constraint manual_entries_description_nonempty check (length(trim(description)) > 0),
  constraint manual_entries_scope_owner_consistent check ((scope = 'family' and owner_profile_id is null) or (scope = 'personal' and owner_profile_id = created_by))
);
create index manual_entries_workspace_scope_owner_idx on public.manual_entries (workspace_id, scope, owner_profile_id);
create index manual_entries_category_idx on public.manual_entries (category_id);

create table public.merchant_rules (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  merchant_match text not null, category_id uuid not null, scope public.data_scope not null default 'family',
  owner_profile_id uuid references public.profiles(id) on delete restrict,
  priority integer not null default 0, enabled boolean not null default true, archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint merchant_rules_category_context_fk foreign key (category_id, workspace_id) references public.categories(id, workspace_id) on delete restrict,
  constraint merchant_rules_match_normalized check (merchant_match = lower(trim(merchant_match)) and length(merchant_match) > 0),
  constraint merchant_rules_scope_owner_consistent check ((scope = 'family' and owner_profile_id is null) or (scope = 'personal' and owner_profile_id = created_by))
);
create index merchant_rules_workspace_scope_owner_idx on public.merchant_rules (workspace_id, scope, owner_profile_id);
create index merchant_rules_category_idx on public.merchant_rules (category_id);
create index merchant_rules_match_idx on public.merchant_rules (workspace_id, merchant_match) where enabled and archived_at is null;

create table public.budgets (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  category_id uuid, amount numeric(14, 2) not null, currency_code text not null default 'CAD',
  start_date date not null, end_date date not null, scope public.data_scope not null default 'family',
  owner_profile_id uuid references public.profiles(id) on delete restrict, archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint budgets_category_context_fk foreign key (category_id, workspace_id) references public.categories(id, workspace_id) on delete restrict,
  constraint budgets_amount_positive check (amount > 0), constraint budgets_currency_cad check (currency_code = 'CAD'),
  constraint budgets_date_range_valid check (end_date >= start_date),
  constraint budgets_scope_owner_consistent check ((scope = 'family' and owner_profile_id is null) or (scope = 'personal' and owner_profile_id = created_by))
);
create index budgets_workspace_scope_owner_idx on public.budgets (workspace_id, scope, owner_profile_id);
create index budgets_category_idx on public.budgets (category_id);

create table public.sync_state (
  plaid_item_id uuid primary key references public.plaid_items(id) on delete cascade,
  cursor text, last_attempt_at timestamptz, last_success_at timestamptz,
  status public.sync_status not null default 'idle', error_code text, error_message text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint sync_state_error_sanitized check ((status = 'failed' and error_code is not null) or (status <> 'failed' and error_code is null and error_message is null))
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  actor_profile_id uuid references public.profiles(id) on delete set null, action text not null,
  target_type text, target_id uuid, scope public.data_scope not null default 'family',
  owner_profile_id uuid references public.profiles(id) on delete restrict,
  details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  constraint audit_events_action_nonempty check (length(trim(action)) > 0),
  constraint audit_events_details_object check (jsonb_typeof(details) = 'object'),
  constraint audit_events_scope_owner_consistent check ((scope = 'family' and owner_profile_id is null) or (scope = 'personal' and owner_profile_id is not null))
);
create index audit_events_workspace_scope_owner_idx on public.audit_events (workspace_id, scope, owner_profile_id, created_at desc);
create index audit_events_target_idx on public.audit_events (target_type, target_id);

-- Definer helpers are deliberately narrow predicates. Their empty search path
-- prevents caller-controlled object resolution, and no helper returns row data.
create or replace function private.is_active_member(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, private as $$
  select exists (select 1 from public.workspace_memberships m where m.workspace_id = p_workspace_id and m.profile_id = (select auth.uid()) and m.status = 'active');
$$;
create or replace function private.is_active_owner(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, private as $$
  select exists (select 1 from public.workspace_memberships m where m.workspace_id = p_workspace_id and m.profile_id = (select auth.uid()) and m.role = 'owner' and m.status = 'active');
$$;
create or replace function private.can_access_scoped_record(p_workspace_id uuid, p_scope public.data_scope, p_owner_profile_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, private as $$
  select private.is_active_member(p_workspace_id)
    and ((p_scope = 'family' and p_owner_profile_id is null) or (p_scope = 'personal' and p_owner_profile_id = (select auth.uid())));
$$;
create or replace function private.shares_active_workspace(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, private as $$
  select p_profile_id = (select auth.uid()) or exists (
    select 1 from public.workspace_memberships me join public.workspace_memberships them on them.workspace_id = me.workspace_id
    where me.profile_id = (select auth.uid()) and me.status = 'active' and them.profile_id = p_profile_id and them.status = 'active');
$$;
create or replace function private.can_access_account(p_account_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, private as $$
  select exists (select 1 from public.accounts a where a.id = p_account_id and private.can_access_scoped_record(a.workspace_id, a.scope, a.owner_profile_id));
$$;
create or replace function private.can_access_transaction(p_transaction_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, private as $$
  select exists (select 1 from public.transactions t join public.accounts a on a.id = t.account_id
    where t.id = p_transaction_id and private.can_access_scoped_record(a.workspace_id, a.scope, a.owner_profile_id));
$$;
create or replace function private.can_view_sync_state(p_plaid_item_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, private as $$
  select exists (
    select 1
    from public.plaid_items p
    where p.id = p_plaid_item_id
      and p.linked_by = (select auth.uid())
      and private.is_active_member(p.workspace_id)
  );
$$;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_active_member(uuid) to authenticated;
grant execute on function private.is_active_owner(uuid) to authenticated;
grant execute on function private.can_access_scoped_record(uuid, public.data_scope, uuid) to authenticated;
grant execute on function private.shares_active_workspace(uuid) to authenticated;
grant execute on function private.can_access_account(uuid) to authenticated;
grant execute on function private.can_access_transaction(uuid) to authenticated;
grant execute on function private.can_view_sync_state(uuid) to authenticated;

create or replace function private.set_updated_at()
returns trigger language plpgsql security definer set search_path = pg_catalog, private as $$
begin new.updated_at := now(); return new; end;
$$;
create or replace function private.enforce_immutable_columns()
returns trigger language plpgsql security definer set search_path = pg_catalog, private as $$
declare immutable_column text;
begin
  foreach immutable_column in array tg_argv loop
    if (to_jsonb(new) -> immutable_column) is distinct from (to_jsonb(old) -> immutable_column) then
      raise exception using errcode = '23514', constraint = tg_table_name || '_' || immutable_column || '_immutable', message = format('%I.%I is immutable', tg_table_name, immutable_column);
    end if;
  end loop;
  return new;
end;
$$;
create or replace function private.protect_active_owner()
returns trigger language plpgsql security definer set search_path = pg_catalog, private as $$
declare
  workspace_owner_id uuid;
begin
  if tg_op <> 'DELETE' and new.role = 'owner' and new.status = 'active' then
    select w.owner_profile_id into workspace_owner_id
    from public.workspaces w
    where w.id = new.workspace_id;

    if workspace_owner_id is distinct from new.profile_id then
      raise exception using
        errcode = '23514',
        constraint = 'workspace_memberships_owner_matches_workspace',
        message = 'the active owner membership must match workspaces.owner_profile_id';
    end if;
  end if;

  if old.role = 'owner' and old.status = 'active'
     and (
       tg_op = 'DELETE'
       or new.role <> 'owner'
       or new.status <> 'active'
       or new.workspace_id <> old.workspace_id
       or new.profile_id <> old.profile_id
     )
     and not exists (
       select 1
       from public.workspace_memberships other
       where other.workspace_id = old.workspace_id
         and other.id <> old.id
         and other.role = 'owner'
         and other.status = 'active'
     ) then
    raise exception using
      errcode = '23514',
      constraint = 'workspace_memberships_last_active_owner',
      message = 'a workspace must retain one active owner';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create or replace function private.assert_workspace_owner(p_workspace_id uuid)
returns void language plpgsql stable security definer set search_path = pg_catalog, private as $$
begin
  if exists (select 1 from public.workspaces w where w.id = p_workspace_id)
     and not exists (
       select 1
       from public.workspaces w
       join public.workspace_memberships m
         on m.workspace_id = w.id
        and m.profile_id = w.owner_profile_id
        and m.role = 'owner'
        and m.status = 'active'
       where w.id = p_workspace_id
     ) then
    raise exception using
      errcode = '23514',
      constraint = 'workspaces_active_owner_consistent',
      message = 'workspaces.owner_profile_id must identify the active owner membership';
  end if;
end;
$$;
create or replace function private.enforce_workspace_owner_consistency()
returns trigger language plpgsql security definer set search_path = pg_catalog, private as $$
declare
  affected_workspace_id uuid;
begin
  if tg_table_name = 'workspaces' then
    if tg_op = 'DELETE' then affected_workspace_id := old.id;
    else affected_workspace_id := new.id;
    end if;
  else
    if tg_op = 'DELETE' then affected_workspace_id := old.workspace_id;
    else affected_workspace_id := new.workspace_id;
    end if;
  end if;

  perform private.assert_workspace_owner(affected_workspace_id);
  return null;
end;
$$;
create or replace function private.assert_category_scope(
  p_category_id uuid,
  p_workspace_id uuid,
  p_scope public.data_scope,
  p_owner_profile_id uuid
)
returns void language plpgsql stable security definer set search_path = pg_catalog, private as $$
begin
  if p_category_id is not null and not exists (
    select 1
    from public.categories category
    where category.id = p_category_id
      and category.workspace_id = p_workspace_id
      and category.scope = p_scope
      and category.owner_profile_id is not distinct from p_owner_profile_id
  ) then
    raise exception using
      errcode = '23514',
      constraint = 'category_scope_matches_record',
      message = 'category scope and owner must match the referencing record';
  end if;
end;
$$;
create or replace function private.enforce_category_scope()
returns trigger language plpgsql security definer set search_path = pg_catalog, private as $$
begin
  perform private.assert_category_scope(new.category_id, new.workspace_id, new.scope, new.owner_profile_id);
  return new;
end;
$$;
create or replace function private.assert_transaction_metadata_scope(
  p_transaction_id uuid,
  p_workspace_id uuid,
  p_scope public.data_scope,
  p_owner_profile_id uuid
)
returns void language plpgsql stable security definer set search_path = pg_catalog, private as $$
begin
  if not exists (
    select 1
    from public.transactions transaction
    join public.accounts account on account.id = transaction.account_id
    where transaction.id = p_transaction_id
      and transaction.workspace_id = p_workspace_id
      and account.scope = p_scope
      and account.owner_profile_id is not distinct from p_owner_profile_id
  ) then
    raise exception using
      errcode = '23514',
      constraint = 'transaction_metadata_scope_matches_account',
      message = 'transaction metadata scope and owner must match its account';
  end if;
end;
$$;
create or replace function private.enforce_transaction_metadata_scope()
returns trigger language plpgsql security definer set search_path = pg_catalog, private as $$
begin
  perform private.assert_transaction_metadata_scope(new.transaction_id, new.workspace_id, new.scope, new.owner_profile_id);
  return new;
end;
$$;
create or replace function private.protect_account_metadata_scope()
returns trigger language plpgsql security definer set search_path = pg_catalog, private as $$
begin
  if (new.scope, new.owner_profile_id) is distinct from (old.scope, old.owner_profile_id)
     and exists (
       select 1
       from public.transactions transaction
       join public.transaction_metadata metadata on metadata.transaction_id = transaction.id
       where transaction.account_id = new.id
         and (
           metadata.scope is distinct from new.scope
           or metadata.owner_profile_id is distinct from new.owner_profile_id
         )
     ) then
    raise exception using
      errcode = '23514',
      constraint = 'accounts_scope_matches_transaction_metadata',
      message = 'account scope cannot strand transaction metadata in a different privacy domain';
  end if;
  return new;
end;
$$;
revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.enforce_immutable_columns() from public, anon, authenticated;
revoke all on function private.protect_active_owner() from public, anon, authenticated;
revoke all on function private.assert_workspace_owner(uuid) from public, anon, authenticated;
revoke all on function private.enforce_workspace_owner_consistency() from public, anon, authenticated;
revoke all on function private.assert_category_scope(uuid, uuid, public.data_scope, uuid) from public, anon, authenticated;
revoke all on function private.enforce_category_scope() from public, anon, authenticated;
revoke all on function private.assert_transaction_metadata_scope(uuid, uuid, public.data_scope, uuid) from public, anon, authenticated;
revoke all on function private.enforce_transaction_metadata_scope() from public, anon, authenticated;
revoke all on function private.protect_account_metadata_scope() from public, anon, authenticated;

create trigger profiles_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger workspaces_updated_at before update on public.workspaces for each row execute function private.set_updated_at();
create trigger memberships_updated_at before update on public.workspace_memberships for each row execute function private.set_updated_at();
create trigger invitations_updated_at before update on public.invitations for each row execute function private.set_updated_at();
create trigger plaid_items_updated_at before update on public.plaid_items for each row execute function private.set_updated_at();
create trigger accounts_updated_at before update on public.accounts for each row execute function private.set_updated_at();
create trigger transactions_updated_at before update on public.transactions for each row execute function private.set_updated_at();
create trigger transaction_metadata_updated_at before update on public.transaction_metadata for each row execute function private.set_updated_at();
create trigger manual_entries_updated_at before update on public.manual_entries for each row execute function private.set_updated_at();
create trigger categories_updated_at before update on public.categories for each row execute function private.set_updated_at();
create trigger merchant_rules_updated_at before update on public.merchant_rules for each row execute function private.set_updated_at();
create trigger budgets_updated_at before update on public.budgets for each row execute function private.set_updated_at();
create trigger sync_state_updated_at before update on public.sync_state for each row execute function private.set_updated_at();

create trigger profiles_id_immutable before update on public.profiles for each row execute function private.enforce_immutable_columns('id');
create trigger memberships_context_immutable before update on public.workspace_memberships for each row execute function private.enforce_immutable_columns('workspace_id', 'profile_id');
create trigger invitations_context_immutable before update on public.invitations for each row execute function private.enforce_immutable_columns('workspace_id', 'email', 'invited_by', 'token_hash');
create trigger plaid_items_provider_immutable before update on public.plaid_items for each row execute function private.enforce_immutable_columns('workspace_id', 'linked_by', 'plaid_item_id', 'institution_id', 'institution_name');
create trigger accounts_provider_immutable before update on public.accounts for each row execute function private.enforce_immutable_columns('workspace_id', 'plaid_item_id', 'linked_by', 'provider_account_id', 'type', 'subtype', 'currency_code', 'mask', 'name');
create trigger transactions_provider_immutable before update on public.transactions for each row execute function private.enforce_immutable_columns('workspace_id', 'account_id', 'plaid_transaction_id');
create trigger transaction_metadata_context_immutable before update on public.transaction_metadata for each row execute function private.enforce_immutable_columns('transaction_id', 'workspace_id', 'scope', 'owner_profile_id');
create trigger manual_entries_context_immutable before update on public.manual_entries for each row execute function private.enforce_immutable_columns('workspace_id', 'created_by');
create trigger categories_context_immutable before update on public.categories for each row execute function private.enforce_immutable_columns('workspace_id', 'created_by', 'scope', 'owner_profile_id');
create trigger merchant_rules_context_immutable before update on public.merchant_rules for each row execute function private.enforce_immutable_columns('workspace_id', 'created_by');
create trigger budgets_context_immutable before update on public.budgets for each row execute function private.enforce_immutable_columns('workspace_id', 'created_by');
create trigger memberships_protect_active_owner before insert or update or delete on public.workspace_memberships for each row execute function private.protect_active_owner();
create constraint trigger workspaces_owner_consistency
  after insert or update on public.workspaces
  deferrable initially deferred for each row
  execute function private.enforce_workspace_owner_consistency();
create constraint trigger memberships_owner_consistency
  after insert or update or delete on public.workspace_memberships
  deferrable initially deferred for each row
  execute function private.enforce_workspace_owner_consistency();
create trigger transaction_metadata_category_scope before insert or update on public.transaction_metadata for each row execute function private.enforce_category_scope();
create trigger manual_entries_category_scope before insert or update on public.manual_entries for each row execute function private.enforce_category_scope();
create trigger merchant_rules_category_scope before insert or update on public.merchant_rules for each row execute function private.enforce_category_scope();
create trigger budgets_category_scope before insert or update on public.budgets for each row execute function private.enforce_category_scope();
create trigger transaction_metadata_account_scope before insert or update on public.transaction_metadata for each row execute function private.enforce_transaction_metadata_scope();
create trigger accounts_protect_metadata_scope before update on public.accounts for each row execute function private.protect_account_metadata_scope();

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.plaid_items enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_metadata enable row level security;
alter table public.manual_entries enable row level security;
alter table public.categories enable row level security;
alter table public.merchant_rules enable row level security;
alter table public.budgets enable row level security;
alter table public.sync_state enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_select on public.profiles for select to authenticated using (private.shares_active_workspace(id));
create policy profiles_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy workspaces_select on public.workspaces for select to authenticated using (private.is_active_member(id));
create policy workspaces_update on public.workspaces for update to authenticated using (private.is_active_owner(id)) with check (private.is_active_owner(id));

create policy memberships_select on public.workspace_memberships for select to authenticated using (private.is_active_member(workspace_id));
create policy memberships_insert on public.workspace_memberships for insert to authenticated with check (private.is_active_owner(workspace_id));
create policy memberships_update on public.workspace_memberships for update to authenticated using (private.is_active_owner(workspace_id)) with check (private.is_active_owner(workspace_id));
create policy memberships_delete on public.workspace_memberships for delete to authenticated using (private.is_active_owner(workspace_id));
create policy invitations_all on public.invitations for all to authenticated using (private.is_active_owner(workspace_id)) with check (private.is_active_owner(workspace_id));

create policy plaid_items_select on public.plaid_items for select to authenticated
  using (linked_by = (select auth.uid()) and private.is_active_member(workspace_id));
create policy plaid_items_update on public.plaid_items for update to authenticated
  using (linked_by = (select auth.uid()) and private.is_active_member(workspace_id))
  with check (linked_by = (select auth.uid()) and private.is_active_member(workspace_id));
create policy accounts_select on public.accounts for select to authenticated using (private.can_access_scoped_record(workspace_id, scope, owner_profile_id));
create policy accounts_update on public.accounts for update to authenticated
  using (linked_by = (select auth.uid()) and private.can_access_scoped_record(workspace_id, scope, owner_profile_id))
  with check (linked_by = (select auth.uid()) and private.can_access_scoped_record(workspace_id, scope, owner_profile_id));
create policy transactions_select on public.transactions for select to authenticated using (private.can_access_account(account_id));

create policy transaction_metadata_select on public.transaction_metadata for select to authenticated
  using (private.can_access_scoped_record(workspace_id, scope, owner_profile_id) and private.can_access_transaction(transaction_id));
create policy transaction_metadata_insert on public.transaction_metadata for insert to authenticated
  with check (updated_by = (select auth.uid()) and private.can_access_scoped_record(workspace_id, scope, owner_profile_id) and private.can_access_transaction(transaction_id));
create policy transaction_metadata_update on public.transaction_metadata for update to authenticated
  using (private.can_access_scoped_record(workspace_id, scope, owner_profile_id) and private.can_access_transaction(transaction_id))
  with check (updated_by = (select auth.uid()) and private.can_access_scoped_record(workspace_id, scope, owner_profile_id) and private.can_access_transaction(transaction_id));
create policy transaction_metadata_delete on public.transaction_metadata for delete to authenticated
  using (private.can_access_scoped_record(workspace_id, scope, owner_profile_id) and private.can_access_transaction(transaction_id));

create policy manual_entries_select on public.manual_entries for select to authenticated using (private.can_access_scoped_record(workspace_id, scope, owner_profile_id));
create policy manual_entries_insert on public.manual_entries for insert to authenticated with check (created_by = (select auth.uid()) and private.can_access_scoped_record(workspace_id, scope, owner_profile_id));
create policy manual_entries_update on public.manual_entries for update to authenticated using (private.can_access_scoped_record(workspace_id, scope, owner_profile_id)) with check (private.can_access_scoped_record(workspace_id, scope, owner_profile_id));
create policy manual_entries_delete on public.manual_entries for delete to authenticated using (private.can_access_scoped_record(workspace_id, scope, owner_profile_id));

create policy categories_select on public.categories for select to authenticated using (private.can_access_scoped_record(workspace_id, scope, owner_profile_id));
create policy categories_insert on public.categories for insert to authenticated with check (created_by = (select auth.uid()) and private.can_access_scoped_record(workspace_id, scope, owner_profile_id));
create policy categories_update on public.categories for update to authenticated using (private.can_access_scoped_record(workspace_id, scope, owner_profile_id)) with check (private.can_access_scoped_record(workspace_id, scope, owner_profile_id));
create policy categories_delete on public.categories for delete to authenticated using (private.can_access_scoped_record(workspace_id, scope, owner_profile_id));

create policy merchant_rules_select on public.merchant_rules for select to authenticated using (private.can_access_scoped_record(workspace_id, scope, owner_profile_id));
create policy merchant_rules_insert on public.merchant_rules for insert to authenticated with check (created_by = (select auth.uid()) and private.can_access_scoped_record(workspace_id, scope, owner_profile_id));
create policy merchant_rules_update on public.merchant_rules for update to authenticated using (private.can_access_scoped_record(workspace_id, scope, owner_profile_id)) with check (private.can_access_scoped_record(workspace_id, scope, owner_profile_id));
create policy merchant_rules_delete on public.merchant_rules for delete to authenticated using (private.can_access_scoped_record(workspace_id, scope, owner_profile_id));

create policy budgets_select on public.budgets for select to authenticated using (private.can_access_scoped_record(workspace_id, scope, owner_profile_id));
create policy budgets_insert on public.budgets for insert to authenticated with check (created_by = (select auth.uid()) and private.can_access_scoped_record(workspace_id, scope, owner_profile_id));
create policy budgets_update on public.budgets for update to authenticated using (private.can_access_scoped_record(workspace_id, scope, owner_profile_id)) with check (private.can_access_scoped_record(workspace_id, scope, owner_profile_id));
create policy budgets_delete on public.budgets for delete to authenticated using (private.can_access_scoped_record(workspace_id, scope, owner_profile_id));
create policy sync_state_select on public.sync_state for select to authenticated using (private.can_view_sync_state(plaid_item_id));
create policy audit_events_select on public.audit_events for select to authenticated using (private.can_access_scoped_record(workspace_id, scope, owner_profile_id));

-- Public is the API schema, but access is opt-in. Anonymous callers get nothing.
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
grant usage on schema public to authenticated, service_role;
grant usage on type public.data_scope, public.membership_role, public.membership_status, public.plaid_item_status, public.account_kind, public.sync_status to authenticated, service_role;

grant select, insert on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;
grant select on public.workspaces to authenticated;
grant update (name) on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_memberships to authenticated;
grant select, insert, update, delete on public.invitations to authenticated;

-- Deliberately omit access_token_ciphertext and its key version. PostgreSQL
-- column privileges keep both values out of PostgREST select-star responses.
grant select (id, workspace_id, linked_by, plaid_item_id, institution_id, institution_name, status, archived_at, created_at, updated_at) on public.plaid_items to authenticated;
grant update (status, archived_at) on public.plaid_items to authenticated;
grant select on public.accounts to authenticated;
grant update (display_name, scope, owner_profile_id, archived_at) on public.accounts to authenticated;
grant select on public.transactions to authenticated;
grant select, insert, update, delete on public.transaction_metadata to authenticated;
grant select, insert, update, delete on public.manual_entries to authenticated;
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.merchant_rules to authenticated;
grant select, insert, update, delete on public.budgets to authenticated;
grant select on public.sync_state to authenticated;
grant select on public.audit_events to authenticated;

-- The server-only admin client uses service_role. This is an intentional RLS
-- bypass for Plaid sync, invitation workflows, bootstrap, and audit appends.
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;


