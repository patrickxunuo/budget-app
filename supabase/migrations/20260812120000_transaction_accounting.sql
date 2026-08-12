-- GH-6: user-owned transaction accounting metadata and rule attribution.
-- Plaid source facts remain on public.transactions and continue to be writable
-- only by the service-role synchronization boundary. This migration adds user
-- choices exclusively to public.transaction_metadata.

create type public.transaction_kind as enum (
  'income',
  'spending',
  'transfer',
  'refund'
);

grant usage on type public.transaction_kind to authenticated, service_role;

alter table public.merchant_rules
  add constraint merchant_rules_id_workspace_unique unique (id, workspace_id);

alter table public.transaction_metadata
  add column kind_override public.transaction_kind,
  add column merchant_rule_id uuid,
  add constraint transaction_metadata_merchant_rule_context_fk
    foreign key (merchant_rule_id, workspace_id)
    references public.merchant_rules (id, workspace_id)
    on delete restrict;

create index transaction_metadata_merchant_rule_idx
  on public.transaction_metadata (merchant_rule_id)
  where merchant_rule_id is not null;

create or replace function private.assert_transaction_metadata_rule_attribution(
  p_merchant_rule_id uuid,
  p_workspace_id uuid,
  p_scope public.data_scope,
  p_owner_profile_id uuid,
  p_category_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, private
as $$
begin
  if p_merchant_rule_id is null then
    return;
  end if;

  if not exists (
    select 1
    from public.merchant_rules rule
    where rule.id = p_merchant_rule_id
      and rule.workspace_id = p_workspace_id
      and rule.scope = p_scope
      and rule.owner_profile_id is not distinct from p_owner_profile_id
      and (p_category_id is null or rule.category_id = p_category_id)
  ) then
    raise exception using
      errcode = '23514',
      constraint = 'transaction_metadata_rule_scope_matches_record',
      message = 'attributed merchant rule must match metadata workspace, privacy domain, and category';
  end if;
end;
$$;

create or replace function private.enforce_transaction_metadata_rule_attribution()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  if tg_table_name = 'transaction_metadata' then
    perform private.assert_transaction_metadata_rule_attribution(
      new.merchant_rule_id,
      new.workspace_id,
      new.scope,
      new.owner_profile_id,
      new.category_id
    );
  elsif tg_table_name = 'merchant_rules' then
    if exists (
      select 1
      from public.transaction_metadata metadata
      where metadata.merchant_rule_id = new.id
        and (
          metadata.workspace_id is distinct from new.workspace_id
          or metadata.scope is distinct from new.scope
          or metadata.owner_profile_id is distinct from new.owner_profile_id
          or (
            metadata.category_id is not null
            and metadata.category_id is distinct from new.category_id
          )
        )
    ) then
      raise exception using
        errcode = '23514',
        constraint = 'transaction_metadata_rule_scope_matches_record',
        message = 'merchant rule update would strand attributed metadata in a different privacy domain or category';
    end if;
  end if;

  return null;
end;
$$;

revoke all on function private.assert_transaction_metadata_rule_attribution(
  uuid, uuid, public.data_scope, uuid, uuid
) from public, anon, authenticated;
revoke all on function private.enforce_transaction_metadata_rule_attribution()
  from public, anon, authenticated;

create constraint trigger transaction_metadata_rule_attribution_consistency
  after insert or update of merchant_rule_id, workspace_id, scope, owner_profile_id, category_id
  on public.transaction_metadata
  deferrable initially deferred
  for each row
  execute function private.enforce_transaction_metadata_rule_attribution();

create constraint trigger merchant_rules_attribution_consistency
  after update of workspace_id, scope, owner_profile_id, category_id
  on public.merchant_rules
  deferrable initially deferred
  for each row
  execute function private.enforce_transaction_metadata_rule_attribution();

-- Reaffirm the source/metadata write boundary after extending both tables.
-- Authenticated members may classify their metadata but cannot rewrite Plaid
-- amounts, dates, names, pending/removal status, or provider payloads.
revoke insert, update, delete on public.transactions from authenticated;
grant select on public.transactions to authenticated;
grant select, insert, update, delete on public.transaction_metadata to authenticated;
