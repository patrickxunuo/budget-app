begin;
set local search_path = public, extensions;
select no_plan();

-- Execute a statement (including SET CONSTRAINTS) in a subtransaction and
-- report whether a workspace/privacy/category invariant rejected it.
create function pg_temp.accounting_rejects(statement text)
returns boolean
language plpgsql
as $$
begin
  execute statement;
  execute 'set constraints all immediate';
  return false;
exception
  when foreign_key_violation or check_violation then
    return true;
end;
$$;

-- DB-ACC-001: the migration exposes the domain enum, user-owned columns, and
-- a workspace-safe composite relationship to merchant_rules.
select is(
  (select array_agg(enumlabel::text order by enumsortorder)
   from pg_enum
   where enumtypid = 'public.transaction_kind'::regtype),
  array['income', 'spending', 'transfer', 'refund']::text[],
  'DB-ACC-001 transaction_kind contains the accounting contract values in order'
);
select col_type_is(
  'public', 'transaction_metadata', 'kind_override', 'public.transaction_kind',
  'DB-ACC-001 metadata has a nullable typed kind override'
);
select has_column(
  'public', 'transaction_metadata', 'merchant_rule_id',
  'DB-ACC-001 metadata records merchant-rule attribution'
);
select ok(
  (select is_nullable = 'YES'
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'transaction_metadata'
     and column_name = 'kind_override')
  and
  (select is_nullable = 'YES'
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'transaction_metadata'
     and column_name = 'merchant_rule_id'),
  'DB-ACC-001 new metadata fields remain optional'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.merchant_rules'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (id, workspace_id)'
  ),
  'DB-ACC-001 merchant rules expose an id/workspace unique key'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.transaction_metadata'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like
        'FOREIGN KEY (merchant_rule_id, workspace_id) REFERENCES merchant_rules(id, workspace_id)%'
  ),
  'DB-ACC-001 rule attribution uses a workspace-safe composite foreign key'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.transaction_metadata'::regclass
      and tgconstraint <> 0
      and tgdeferrable
      and tginitdeferred
  ),
  'DB-ACC-001 metadata rule consistency is enforced by a deferred constraint trigger'
);

-- Shared fixtures: one family workspace with both family and personal privacy
-- domains. The database intentionally permits only one workspace today, while
-- the composite FK above protects the future multi-workspace boundary.
insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '91000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'accounting-owner@example.test', '', now(),
  '{}', '{}', now(), now()
);
insert into public.profiles(id, display_name)
values ('91000000-0000-4000-8000-000000000001', 'Accounting Owner');
insert into public.workspaces(id, singleton_key, name, owner_profile_id)
values (
  '92000000-0000-4000-8000-000000000001', true, 'Accounting Household',
  '91000000-0000-4000-8000-000000000001'
);
insert into public.workspace_memberships(workspace_id, profile_id, role, status)
values (
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001', 'owner', 'active'
);
set constraints all immediate;
set constraints all deferred;

insert into public.plaid_items(
  id, workspace_id, linked_by, plaid_item_id, institution_id,
  institution_name, access_token_ciphertext, access_token_key_version, status
) values (
  '93000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'accounting-provider-item', 'ins-accounting', 'Accounting Test Bank',
  decode('010203', 'hex'), 1, 'active'
);
insert into public.accounts(
  id, workspace_id, plaid_item_id, linked_by, provider_account_id, type,
  subtype, currency_code, mask, name, display_name, scope, owner_profile_id
) values (
  '94000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'accounting-chequing', 'depository', 'chequing', 'CAD', '0606',
  'Accounting Chequing', 'Accounting Chequing', 'family', null
);
insert into public.transactions(
  id, workspace_id, account_id, plaid_transaction_id, amount, currency_code,
  authorized_date, transaction_date, merchant_name, name, pending,
  provider_payload
) values (
  '95000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  'accounting-source-transaction', 42.75, 'CAD', '2026-08-10',
  '2026-08-11', 'Original Merchant', 'Original Source Name', false,
  '{"provider":"original","category":{"primary":"GENERAL_MERCHANDISE"}}'
);
insert into public.categories(
  id, workspace_id, created_by, name, scope, owner_profile_id
) values
(
  '96000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'Groceries', 'family', null
),
(
  '96000000-0000-4000-8000-000000000002',
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'Transport', 'family', null
),
(
  '96000000-0000-4000-8000-000000000003',
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'Personal', 'personal', '91000000-0000-4000-8000-000000000001'
);
insert into public.merchant_rules(
  id, workspace_id, created_by, merchant_match, category_id, scope,
  owner_profile_id
) values
(
  '97000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'grocer', '96000000-0000-4000-8000-000000000001', 'family', null
),
(
  '97000000-0000-4000-8000-000000000002',
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'transit', '96000000-0000-4000-8000-000000000002', 'family', null
),
(
  '97000000-0000-4000-8000-000000000003',
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'personal-shop', '96000000-0000-4000-8000-000000000003',
  'personal', '91000000-0000-4000-8000-000000000001'
);

-- DB-ACC-002: all dimensions of a valid attribution agree.
insert into public.transaction_metadata(
  transaction_id, workspace_id, updated_by, scope, owner_profile_id,
  category_id, note, excluded, kind_override, merchant_rule_id
) values (
  '95000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001', 'family', null,
  '96000000-0000-4000-8000-000000000001', 'Original note', false,
  'spending', '97000000-0000-4000-8000-000000000001'
);
set constraints all immediate;
set constraints all deferred;
select results_eq(
  $$select kind_override::text, merchant_rule_id
    from public.transaction_metadata
    where transaction_id = '95000000-0000-4000-8000-000000000001'$$,
  $$values ('spending'::text, '97000000-0000-4000-8000-000000000001'::uuid)$$,
  'DB-ACC-002 the valid override and attribution persist'
);

-- DB-ACC-003: the trigger is deferred, so each probe explicitly forces it.
select ok(
  pg_temp.accounting_rejects($statement$
    update public.transaction_metadata
       set workspace_id = '92000000-0000-4000-8000-000000000099'
     where transaction_id = '95000000-0000-4000-8000-000000000001'
  $statement$),
  'DB-ACC-003 cross-workspace metadata/rule context is rejected'
);
select ok(
  pg_temp.accounting_rejects($statement$
    update public.transaction_metadata
       set merchant_rule_id = '97000000-0000-4000-8000-000000000003'
     where transaction_id = '95000000-0000-4000-8000-000000000001'
  $statement$),
  'DB-ACC-003 cross-privacy-domain rule attribution is rejected'
);
select ok(
  pg_temp.accounting_rejects($statement$
    update public.transaction_metadata
       set merchant_rule_id = '97000000-0000-4000-8000-000000000002'
     where transaction_id = '95000000-0000-4000-8000-000000000001'
  $statement$),
  'DB-ACC-003 a rule pointing at a different category is rejected'
);
select results_eq(
  $$select workspace_id, scope::text, category_id, merchant_rule_id
    from public.transaction_metadata
    where transaction_id = '95000000-0000-4000-8000-000000000001'$$,
  $$values (
    '92000000-0000-4000-8000-000000000001'::uuid,
    'family'::text,
    '96000000-0000-4000-8000-000000000001'::uuid,
    '97000000-0000-4000-8000-000000000001'::uuid
  )$$,
  'DB-ACC-003 rejected changes leave the valid attribution intact'
);

-- DB-ACC-004: users may edit their metadata record while every provider-owned
-- fact remains byte-for-byte unchanged on the transaction row.
create temp table source_before as
select amount, currency_code, authorized_date, transaction_date, merchant_name,
       name, pending, provider_payload
from public.transactions
where id = '95000000-0000-4000-8000-000000000001';

update public.transaction_metadata
   set note = 'Updated user note',
       excluded = true,
       category_id = '96000000-0000-4000-8000-000000000002',
       kind_override = 'transfer',
       merchant_rule_id = '97000000-0000-4000-8000-000000000002'
 where transaction_id = '95000000-0000-4000-8000-000000000001';
set constraints all immediate;
set constraints all deferred;
select results_eq(
  $$select note, excluded, category_id, kind_override::text, merchant_rule_id
    from public.transaction_metadata
    where transaction_id = '95000000-0000-4000-8000-000000000001'$$,
  $$values (
    'Updated user note'::text, true,
    '96000000-0000-4000-8000-000000000002'::uuid,
    'transfer'::text,
    '97000000-0000-4000-8000-000000000002'::uuid
  )$$,
  'DB-ACC-004 note, exclusion, category, override, and attribution all change'
);
select ok(
  (select row(amount, currency_code, authorized_date, transaction_date,
              merchant_name, name, pending, provider_payload)
     from public.transactions
    where id = '95000000-0000-4000-8000-000000000001')
  is not distinct from
  (select row(amount, currency_code, authorized_date, transaction_date,
              merchant_name, name, pending, provider_payload)
     from source_before),
  'DB-ACC-004 metadata updates do not rewrite Plaid amount/date/name/status/payload facts'
);

select * from finish();
rollback;

