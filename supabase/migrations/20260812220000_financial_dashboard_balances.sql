-- GH-9: nullable provider balance cache. Values remain service-controlled
-- provider facts and never participate in cash-flow totals.
alter table public.plaid_pending_accounts
  add column available_balance_cents bigint,
  add column current_balance_cents bigint,
  add column credit_limit_cents bigint,
  add column balance_updated_at timestamptz;

alter table public.accounts
  add column available_balance_cents bigint,
  add column current_balance_cents bigint,
  add column credit_limit_cents bigint,
  add column balance_updated_at timestamptz,
  add constraint accounts_available_balance_safe check (
    available_balance_cents is null
    or available_balance_cents between -9007199254740991 and 9007199254740991
  ),
  add constraint accounts_current_balance_safe check (
    current_balance_cents is null
    or current_balance_cents between -9007199254740991 and 9007199254740991
  ),
  add constraint accounts_credit_limit_nonnegative check (
    credit_limit_cents is null or credit_limit_cents >= 0
  );

revoke update (
  available_balance_cents,
  current_balance_cents,
  credit_limit_cents,
  balance_updated_at
) on public.accounts from authenticated;

grant update (
  available_balance_cents,
  current_balance_cents,
  credit_limit_cents,
  balance_updated_at
) on public.accounts to service_role;
