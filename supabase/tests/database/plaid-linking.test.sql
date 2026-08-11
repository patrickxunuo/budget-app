begin;
set local search_path = public, extensions;
select no_plan();

-- API-015 structural boundary: pending candidates and token material are service-only.
select has_table('public', 'plaid_pending_accounts', 'API-015 creates the service-only pending Plaid candidate table');
select ok(
  not has_table_privilege('anon', 'public.plaid_pending_accounts', 'SELECT')
    and not has_table_privilege('authenticated', 'public.plaid_pending_accounts', 'SELECT')
    and not has_table_privilege('authenticated', 'public.plaid_pending_accounts', 'INSERT')
    and not has_table_privilege('authenticated', 'public.plaid_pending_accounts', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.plaid_pending_accounts', 'DELETE'),
  'API-015 browser roles have no pending-candidate privileges'
);
select ok(
  not has_column_privilege('authenticated', 'public.plaid_items', 'access_token_ciphertext', 'SELECT')
    and not has_column_privilege('authenticated', 'public.plaid_items', 'access_token_key_version', 'SELECT'),
  'API-015 browser roles cannot read encrypted tokens or key versions'
);
select ok(
  not has_column_privilege('authenticated', 'public.plaid_items', 'status', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.accounts', 'scope', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.accounts', 'owner_profile_id', 'UPDATE'),
  'API-015 authenticated users cannot directly rewrite Plaid lifecycle or account ownership fields'
);
select ok(
  has_function_privilege('service_role', 'public.activate_plaid_review(uuid,uuid,uuid,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.activate_plaid_review(uuid,uuid,uuid,jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.activate_plaid_review(uuid,uuid,uuid,jsonb)', 'EXECUTE'),
  'API-015 activation is executable only by the service role'
);

-- Real activation fixtures: one household, three identities, and an existing
-- active Family account used to exercise duplicate protection.
insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
('71000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'plaid-owner@example.test', '', now(), '{}', '{}', now(), now()),
('71000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'plaid-member@example.test', '', now(), '{}', '{}', now(), now()),
('71000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'plaid-foreign@example.test', '', now(), '{}', '{}', now(), now());
insert into public.profiles(id, display_name) values
('71000000-0000-0000-0000-000000000001', 'Plaid Owner'),
('71000000-0000-0000-0000-000000000002', 'Plaid Member'),
('71000000-0000-0000-0000-000000000003', 'Foreign Member');
insert into public.workspaces(id, singleton_key, name, owner_profile_id)
values ('72000000-0000-0000-0000-000000000001', true, 'Plaid Household', '71000000-0000-0000-0000-000000000001');
insert into public.workspace_memberships(workspace_id, profile_id, role, status) values
('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 'owner', 'active'),
('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'member', 'active'),
('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000003', 'member', 'active');
set constraints all immediate;
set constraints all deferred;

insert into public.plaid_items(id, workspace_id, linked_by, plaid_item_id, institution_id, institution_name, access_token_ciphertext, access_token_key_version, status) values
('73000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'existing-item', 'ins-ca', 'Canadian Test Bank', decode('010203', 'hex'), 1, 'active'),
('73000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'mixed-item', 'ins-ca', 'Canadian Test Bank', decode('010204', 'hex'), 1, 'pending'),
('73000000-0000-0000-0000-000000000003', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'ineligible-item', 'ins-ca', 'Canadian Test Bank', decode('010205', 'hex'), 1, 'pending'),
('73000000-0000-0000-0000-000000000004', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'foreign-item', 'ins-ca', 'Canadian Test Bank', decode('010206', 'hex'), 1, 'pending'),
('73000000-0000-0000-0000-000000000005', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'expired-item', 'ins-ca', 'Canadian Test Bank', decode('010207', 'hex'), 1, 'pending'),
('73000000-0000-0000-0000-000000000006', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'duplicate-item', 'ins-ca', 'Canadian Test Bank', decode('010208', 'hex'), 1, 'pending'),
('73000000-0000-0000-0000-000000000007', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'override-item', 'ins-ca', 'Canadian Test Bank', decode('010209', 'hex'), 1, 'pending');

insert into public.accounts(id, workspace_id, plaid_item_id, linked_by, provider_account_id, type, subtype, currency_code, mask, name, display_name, scope, owner_profile_id)
values ('74000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'existing-family', 'depository', 'chequing', 'CAD', '1204', 'Everyday Chequing', 'Everyday Chequing', 'family', null);

insert into public.plaid_pending_accounts(review_id, plaid_item_id, workspace_id, linked_by, provider_account_id, name, official_name, mask, type, subtype, currency_code, eligible, eligibility_message, duplicate_account_id, expires_at, created_at) values
-- mixed Personal + Family success
('73000000-0000-0000-0000-000000000002', '73000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'mixed-personal', 'Private Savings', 'Private Savings Account', '5678', 'depository', 'savings', 'CAD', true, null, null, now() + interval '30 minutes', now()),
('73000000-0000-0000-0000-000000000002', '73000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'mixed-family', 'Family Card', 'Family Credit Card', '9911', 'credit', 'credit card', 'CAD', true, null, null, now() + interval '30 minutes', now()),
-- rejection cases
('73000000-0000-0000-0000-000000000003', '73000000-0000-0000-0000-000000000003', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'ineligible-usd', 'USD Chequing', null, '2222', 'depository', 'checking', 'USD', false, 'Only Canadian-dollar accounts can be connected right now.', null, now() + interval '30 minutes', now()),
('73000000-0000-0000-0000-000000000004', '73000000-0000-0000-0000-000000000004', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'foreign-selection', 'Foreign Selection', null, '3333', 'depository', 'checking', 'CAD', true, null, null, now() + interval '30 minutes', now()),
('73000000-0000-0000-0000-000000000005', '73000000-0000-0000-0000-000000000005', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'expired-selection', 'Expired Selection', null, '4444', 'depository', 'checking', 'CAD', true, null, null, now() - interval '30 minutes', now() - interval '60 minutes'),
-- nonduplicate first proves duplicate failure does not partially activate
('73000000-0000-0000-0000-000000000006', '73000000-0000-0000-0000-000000000006', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'safe-first', 'Safe Savings', null, '5555', 'depository', 'savings', 'CAD', true, null, null, now() + interval '30 minutes', now()),
('73000000-0000-0000-0000-000000000006', '73000000-0000-0000-0000-000000000006', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'duplicate-family', 'Everyday Chequing', null, '1204', 'depository', 'checking', 'CAD', true, null, '74000000-0000-0000-0000-000000000001', now() + interval '30 minutes', now()),
('73000000-0000-0000-0000-000000000007', '73000000-0000-0000-0000-000000000007', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'override-family', 'Everyday Chequing', null, '1204', 'depository', 'checking', 'CAD', true, null, '74000000-0000-0000-0000-000000000001', now() + interval '30 minutes', now());

-- API-007: direct execution atomically creates mixed ownership and consumes review rows.
select lives_ok(
  $$select public.activate_plaid_review(
    '73000000-0000-0000-0000-000000000002',
    '72000000-0000-0000-0000-000000000001',
    '71000000-0000-0000-0000-000000000002',
    '[{"providerAccountId":"mixed-personal","scope":"personal"},{"providerAccountId":"mixed-family","scope":"family"}]'::jsonb
  )$$,
  'API-007 mixed Personal and Family activation succeeds'
);
select results_eq(
  $$select provider_account_id, scope::text, owner_profile_id from public.accounts where plaid_item_id = '73000000-0000-0000-0000-000000000002' order by provider_account_id$$,
  $$values
    ('mixed-family'::text, 'family'::text, null::uuid),
    ('mixed-personal'::text, 'personal'::text, '71000000-0000-0000-0000-000000000002'::uuid)$$,
  'API-007 mixed activation applies Family-null and Personal-linker ownership'
);
select is((select status::text from public.plaid_items where id = '73000000-0000-0000-0000-000000000002'), 'active', 'API-007 activation moves the pending Item to active');
select is((select count(*) from public.plaid_pending_accounts where review_id = '73000000-0000-0000-0000-000000000002'), 0::bigint, 'API-007 activation deletes all consumed candidates');

-- API-010: every rejection leaves its pending Item unchanged and creates no accounts.
select throws_ok(
  $$select public.activate_plaid_review('73000000-0000-0000-0000-000000000003','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','[{"providerAccountId":"ineligible-usd","scope":"personal"}]'::jsonb)$$,
  '22023', 'ineligible account selection', 'API-010 rejects ineligible accounts'
);
select throws_ok(
  $$select public.activate_plaid_review('73000000-0000-0000-0000-000000000004','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000003','[{"providerAccountId":"foreign-selection","scope":"personal"}]'::jsonb)$$,
  '42501', 'forbidden', 'API-010 rejects a review owned by another member'
);
select throws_ok(
  $$select public.activate_plaid_review('73000000-0000-0000-0000-000000000005','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','[{"providerAccountId":"expired-selection","scope":"personal"}]'::jsonb)$$,
  'P0001', 'review expired', 'API-010 rejects expired reviews'
);
select throws_ok(
  $$select public.activate_plaid_review('73000000-0000-0000-0000-000000000003','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','[{"providerAccountId":"unknown-provider","scope":"personal"}]'::jsonb)$$,
  '22023', 'unknown account selection', 'API-010 rejects provider ids outside the pending review'
);
select is(
  (select count(*) from public.accounts where plaid_item_id in ('73000000-0000-0000-0000-000000000003','73000000-0000-0000-0000-000000000004','73000000-0000-0000-0000-000000000005')),
  0::bigint,
  'API-010 rejected selections produce no partial accounts'
);

-- API-008/009: duplicate failure is atomic; explicit override activates and audits.
select throws_ok(
  $$select public.activate_plaid_review(
    '73000000-0000-0000-0000-000000000006',
    '72000000-0000-0000-0000-000000000001',
    '71000000-0000-0000-0000-000000000002',
    '[{"providerAccountId":"safe-first","scope":"personal"},{"providerAccountId":"duplicate-family","scope":"family"}]'::jsonb
  )$$,
  '23505', 'duplicate account override required', 'API-008 rejects a likely Family duplicate without override'
);
select is((select count(*) from public.accounts where plaid_item_id = '73000000-0000-0000-0000-000000000006'), 0::bigint, 'API-008 duplicate failure rolls back earlier account inserts');
select is((select status::text from public.plaid_items where id = '73000000-0000-0000-0000-000000000006'), 'pending', 'API-008 duplicate failure leaves the Item pending');
select is((select count(*) from public.plaid_pending_accounts where review_id = '73000000-0000-0000-0000-000000000006'), 2::bigint, 'API-008 duplicate failure preserves candidates for retry');
select lives_ok(
  $$select public.activate_plaid_review(
    '73000000-0000-0000-0000-000000000007',
    '72000000-0000-0000-0000-000000000001',
    '71000000-0000-0000-0000-000000000002',
    '[{"providerAccountId":"override-family","scope":"family","acceptDuplicate":true}]'::jsonb
  )$$,
  'API-009 explicit duplicate override activates successfully'
);
select is((select count(*) from public.accounts where plaid_item_id = '73000000-0000-0000-0000-000000000007' and scope = 'family' and owner_profile_id is null), 1::bigint, 'API-009 override creates the requested Family account');
select is((select count(*) from public.audit_events where action = 'plaid.duplicate_override' and actor_profile_id = '71000000-0000-0000-0000-000000000002' and details @> '{"existingAccountId":"74000000-0000-0000-0000-000000000001","providerAccountId":"override-family"}'::jsonb), 1::bigint, 'API-009 override records an attributable audit event');

-- API-008 concurrency regression: Family duplicate check and insert share one
-- transaction-scoped advisory lock, closing the serialized race window.
select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'activate_plaid_review'
      and position('pg_advisory_xact_lock' in lower(pg_get_functiondef(p.oid))) > 0
      and position('pg_advisory_xact_lock' in lower(pg_get_functiondef(p.oid))) <
          position('select a.* into v_duplicate' in lower(pg_get_functiondef(p.oid)))
  ),
  'API-008 Family activation takes a transaction-scoped advisory lock before duplicate lookup and insert'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'activate_plaid_review'
      and lower(pg_get_functiondef(p.oid)) ~ E'pg_advisory_lock\\s*\\('
  ),
  'API-008 duplicate serialization never leaks a session-scoped advisory lock'
);

-- Personal scope deliberately bypasses Family duplicate override while the
-- equivalent Family selection above requires explicit acceptance.
insert into public.plaid_items(id, workspace_id, linked_by, plaid_item_id, institution_id, institution_name, access_token_ciphertext, access_token_key_version, status)
values ('73000000-0000-0000-0000-000000000008', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'personal-duplicate-item', 'ins-ca', 'Canadian Test Bank', decode('010210', 'hex'), 1, 'pending');
insert into public.plaid_pending_accounts(review_id, plaid_item_id, workspace_id, linked_by, provider_account_id, name, official_name, mask, type, subtype, currency_code, eligible, eligibility_message, duplicate_account_id, expires_at)
values ('73000000-0000-0000-0000-000000000008', '73000000-0000-0000-0000-000000000008', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'personal-same-identity', 'Everyday Chequing', null, '1204', 'depository', 'checking', 'CAD', true, null, '74000000-0000-0000-0000-000000000001', now() + interval '30 minutes');
select lives_ok(
  $$select public.activate_plaid_review(
    '73000000-0000-0000-0000-000000000008',
    '72000000-0000-0000-0000-000000000001',
    '71000000-0000-0000-0000-000000000002',
    '[{"providerAccountId":"personal-same-identity","scope":"personal"}]'::jsonb
  )$$,
  'API-008 Personal selection does not require a Family duplicate override'
);
select is(
  (select count(*) from public.accounts where plaid_item_id = '73000000-0000-0000-0000-000000000008' and scope = 'personal' and owner_profile_id = '71000000-0000-0000-0000-000000000002'),
  1::bigint,
  'API-008 Personal duplicate-shaped account activates with Personal ownership'
);
select is(
  (select count(*) from public.audit_events where action = 'plaid.duplicate_override' and target_id in (select id from public.accounts where plaid_item_id = '73000000-0000-0000-0000-000000000008')),
  0::bigint,
  'API-008 Personal activation records no Family duplicate-override audit'
);
select * from finish();
rollback;