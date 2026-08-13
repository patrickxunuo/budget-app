begin;
set local search_path = public, extensions;
select no_plan();

-- GH-5 database fixtures: one owner, one foreign identity, one active Item,
-- and one activated account. The transaction remains rollback-only.
insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
('81000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sync-owner@example.test', '', now(), '{}', '{}', now(), now()),
('81000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sync-foreign@example.test', '', now(), '{}', '{}', now(), now());
insert into public.profiles(id, display_name) values
('81000000-0000-4000-8000-000000000001', 'Sync Owner'),
('81000000-0000-4000-8000-000000000002', 'Foreign Member');
insert into public.workspaces(id, singleton_key, name, owner_profile_id)
values ('82000000-0000-4000-8000-000000000001', true, 'Sync Household', '81000000-0000-4000-8000-000000000001');
insert into public.workspace_memberships(workspace_id, profile_id, role, status) values
('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'owner', 'active'),
('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', 'member', 'active');
set constraints all immediate;
set constraints all deferred;

insert into public.plaid_items(id, workspace_id, linked_by, plaid_item_id, institution_id, institution_name, access_token_ciphertext, access_token_key_version, status)
values ('83000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'sync-provider-item', 'ins-sync', 'Maple Test Bank', decode('010203', 'hex'), 1, 'active');
insert into public.accounts(id, workspace_id, plaid_item_id, linked_by, provider_account_id, type, subtype, currency_code, mask, name, display_name, scope, owner_profile_id)
values ('84000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'provider-chequing', 'depository', 'chequing', 'CAD', '1204', 'Everyday Chequing', 'Everyday Chequing', 'personal', '81000000-0000-4000-8000-000000000001');
insert into public.transactions(workspace_id, account_id, plaid_transaction_id, amount, transaction_date, name, pending) values
('82000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', 'modify-me', 10.00, '2026-08-10', 'Old merchant name', false),
('82000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', 'remove-me', 4.00, '2026-08-09', 'Removed purchase', false);

select ok(
  has_function_privilege('service_role', 'public.claim_plaid_sync(uuid,uuid,text,uuid,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.commit_plaid_sync(uuid,uuid,text,text,text,jsonb,jsonb,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.claim_plaid_sync(uuid,uuid,text,uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.commit_plaid_sync(uuid,uuid,text,text,text,jsonb,jsonb,jsonb)', 'EXECUTE'),
  'API-005 sync claims and atomic commits are service-only'
);

-- API-001: what the service collected across all provider pages reaches one
-- commit call; no intermediate cursor is ever persisted.
select lives_ok(
  $$select public.claim_plaid_sync('83000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000001','member','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001')$$,
  'API-001 an active owner atomically claims the Item'
);
select lives_ok(
  $$select public.commit_plaid_sync(
    '83000000-0000-4000-8000-000000000001',
    '85000000-0000-4000-8000-000000000001',
    null,
    'final-cursor',
    'provider-request-final',
    '[
      {"transactionId":"pending-1","accountId":"provider-chequing","amount":8.50,"currencyCode":"CAD","authorizedDate":"2026-08-10","date":"2026-08-11","merchantName":"Corner Shop","name":"Corner Shop","pending":true,"pendingTransactionId":null,"payload":{}},
      {"transactionId":"posted-1","accountId":"provider-chequing","amount":8.50,"currencyCode":"CAD","authorizedDate":"2026-08-10","date":"2026-08-11","merchantName":"Corner Shop","name":"Corner Shop","pending":false,"pendingTransactionId":"pending-1","payload":{}}
    ]'::jsonb,
    '[{"transactionId":"modify-me","accountId":"provider-chequing","amount":12.25,"currencyCode":"CAD","authorizedDate":null,"date":"2026-08-10","merchantName":"Updated Market","name":"Updated Market","pending":false,"pendingTransactionId":null,"payload":{}}]'::jsonb,
    '["remove-me"]'::jsonb
  )$$,
  'API-001 a complete multi-page pass commits as one database operation'
);
select is(
  (select cursor from public.sync_state where plaid_item_id = '83000000-0000-4000-8000-000000000001'),
  'final-cursor',
  'API-001 only the final cursor persists'
);
select results_eq(
  $$select plaid_transaction_id, amount, removed_at is null as active from public.transactions where account_id = '84000000-0000-4000-8000-000000000001' order by plaid_transaction_id$$,
  $$values
    ('modify-me'::text, 12.25::numeric, true),
    ('pending-1'::text, 8.50::numeric, false),
    ('posted-1'::text, 8.50::numeric, true),
    ('remove-me'::text, 4.00::numeric, false)$$,
  'API-002 added, modified, removed, and pending-to-posted changes apply together'
);

-- API-002: replaying the same provider events under a new legitimate claim is
-- idempotent and never resurrects/double-counts the pending predecessor.
select public.claim_plaid_sync('83000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000002','nightly');
select public.commit_plaid_sync(
  '83000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000002','final-cursor','final-cursor','provider-request-replay',
  '[
    {"transactionId":"pending-1","accountId":"provider-chequing","amount":8.50,"currencyCode":"CAD","authorizedDate":"2026-08-10","date":"2026-08-11","merchantName":"Corner Shop","name":"Corner Shop","pending":true,"pendingTransactionId":null,"payload":{}},
    {"transactionId":"posted-1","accountId":"provider-chequing","amount":8.50,"currencyCode":"CAD","authorizedDate":"2026-08-10","date":"2026-08-11","merchantName":"Corner Shop","name":"Corner Shop","pending":false,"pendingTransactionId":"pending-1","payload":{}}
  ]'::jsonb,
  '[{"transactionId":"modify-me","accountId":"provider-chequing","amount":12.25,"currencyCode":"CAD","authorizedDate":null,"date":"2026-08-10","merchantName":"Updated Market","name":"Updated Market","pending":false,"pendingTransactionId":null,"payload":{}}]'::jsonb,
  '["remove-me"]'::jsonb
);
select is(
  (select count(*) from public.transactions where account_id = '84000000-0000-4000-8000-000000000001'),
  4::bigint,
  'API-002 replay creates no duplicate transaction rows'
);
select is(
  (select count(*) from public.transactions where account_id = '84000000-0000-4000-8000-000000000001' and removed_at is null),
  2::bigint,
  'API-002 replay leaves exactly the posted and modified transactions countable'
);

-- API-002 regression: provider page ordering may deliver the posted replacement
-- before its pending predecessor. A later pending event must stay removed.
select public.claim_plaid_sync('83000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000020','nightly');
select public.commit_plaid_sync(
  '83000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000020','final-cursor','posted-first-cursor','provider-request-posted-first',
  '[{"transactionId":"posted-before-pending","accountId":"provider-chequing","amount":19.75,"currencyCode":"CAD","authorizedDate":"2026-08-10","date":"2026-08-11","merchantName":"Order Safe Cafe","name":"Order Safe Cafe","pending":false,"pendingTransactionId":"pending-arrives-later","payload":{}}]'::jsonb,
  '[]'::jsonb,'[]'::jsonb
);
select public.claim_plaid_sync('83000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000021','nightly');
select public.commit_plaid_sync(
  '83000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000021','posted-first-cursor','pending-late-cursor','provider-request-pending-late',
  '[{"transactionId":"pending-arrives-later","accountId":"provider-chequing","amount":19.75,"currencyCode":"CAD","authorizedDate":"2026-08-10","date":"2026-08-11","merchantName":"Order Safe Cafe","name":"Order Safe Cafe","pending":true,"pendingTransactionId":null,"payload":{}}]'::jsonb,
  '[]'::jsonb,'[]'::jsonb
);
select results_eq(
  $$select plaid_transaction_id, removed_at is null as active
    from public.transactions
    where plaid_transaction_id in ('posted-before-pending', 'pending-arrives-later')
    order by plaid_transaction_id$$,
  $$values
    ('pending-arrives-later'::text, false),
    ('posted-before-pending'::text, true)$$,
  'API-002 posted-before-pending ordering keeps the predecessor removed'
);
select is(
  (select count(*) from public.transactions
   where plaid_transaction_id in ('posted-before-pending', 'pending-arrives-later')
     and removed_at is null),
  1::bigint,
  'API-002 posted-before-pending ordering never double counts the purchase'
);
-- API-004: a live claim conflicts, while an abandoned claim older than the
-- recovery window may be reclaimed.
select public.claim_plaid_sync('83000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000003','webhook');
select throws_ok(
  $$select public.claim_plaid_sync('83000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000004','nightly')$$,
  '55P03', 'sync in progress', 'API-004 a second live claim receives conflict'
);
update public.sync_state set claim_started_at = now() - interval '16 minutes'
where plaid_item_id = '83000000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.claim_plaid_sync('83000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000004','nightly')$$,
  'API-004 a stale claim is recoverable'
);
select is(
  (select current_request_id from public.sync_state where plaid_item_id = '83000000-0000-4000-8000-000000000001'),
  '85000000-0000-4000-8000-000000000004'::uuid,
  'API-004 stale recovery installs only the new request identity'
);

-- API-005: actor ownership and account identity fail closed, and a rejected
-- full-pass commit changes neither transactions nor cursor.
select throws_ok(
  $$select public.claim_plaid_sync('83000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000005','member','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002')$$,
  '42501', 'forbidden', 'API-005 a foreign member cannot claim another owner''s Item'
);
update public.sync_state set current_request_id = null, current_trigger = null, claim_started_at = null, status = 'succeeded'
where plaid_item_id = '83000000-0000-4000-8000-000000000001';
select public.claim_plaid_sync('83000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000006','nightly');
-- An account this Item never linked is not an attack: Plaid returns activity
-- for every account on the Item. Its rows are skipped so the rest of the page
-- still applies, and no transaction can attach to an account outside the Item
-- because every lookup is scoped by plaid_item_id.
select lives_ok(
  $$select public.commit_plaid_sync(
    '83000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000006','pending-late-cursor','unlinked-account-page','provider-request-foreign',
    '[{"transactionId":"evil-foreign","accountId":"provider-account-unknown","amount":999,"currencyCode":"CAD","authorizedDate":null,"date":"2026-08-11","merchantName":null,"name":"Foreign","pending":false,"pendingTransactionId":null,"payload":{}}]'::jsonb,
    '[]'::jsonb,'[]'::jsonb
  )$$,
  'API-005 a page naming an unlinked account commits instead of aborting'
);
select is(
  (select count(*) from public.transactions where plaid_transaction_id = 'evil-foreign'),
  0::bigint,
  'API-005 unlinked account data produces no transaction changes'
);

-- Restore the in-flight claim and cursor the archived-Item case below depends on.
update public.sync_state set cursor = 'pending-late-cursor', status = 'succeeded',
  current_request_id = null, current_trigger = null, claim_started_at = null
where plaid_item_id = '83000000-0000-4000-8000-000000000001';
select public.claim_plaid_sync('83000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000006','nightly');

-- API-005: the Item can be archived while Plaid pages are in flight. Commit
-- must revalidate under its own lock and preserve both data and cursor.
update public.plaid_items set archived_at = now()
where id = '83000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.commit_plaid_sync(
    '83000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000006','pending-late-cursor','archived-must-not-persist','provider-request-archived',
    '[]'::jsonb,'[]'::jsonb,'[]'::jsonb
  )$$,
  '55000', 'item unavailable', 'API-005 an Item archived after claim cannot commit'
);
select is(
  (select cursor from public.sync_state where plaid_item_id = '83000000-0000-4000-8000-000000000001'),
  'pending-late-cursor',
  'API-005 archive-between-claim-and-commit does not advance the cursor'
);
update public.plaid_items set archived_at = null
where id = '83000000-0000-4000-8000-000000000001';

-- API-012: failure metadata keeps both correlation identifiers and its durable time.
select public.fail_plaid_sync(
  '83000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000006',
  'provider_unavailable',
  'Transaction updates will be retried automatically.',
  false,
  'provider-request-failed'
);
select ok(
  (select last_failure_at is not null from public.sync_state
   where plaid_item_id = '83000000-0000-4000-8000-000000000001'),
  'API-012 failure time persists durably'
);
select is(
  (select last_failure_request_id from public.sync_state
   where plaid_item_id = '83000000-0000-4000-8000-000000000001'),
  '85000000-0000-4000-8000-000000000006'::uuid,
  'API-012 internal failure request ID persists durably'
);
select is(
  (select provider_request_id from public.sync_state
   where plaid_item_id = '83000000-0000-4000-8000-000000000001'),
  'provider-request-failed',
  'API-012 provider request ID persists durably'
);
-- API-012 structural durability: bounded retry state and repair flags remain
-- service-only and raw token material cannot be selected by browser roles.
select has_column(
  'public', 'sync_state', 'next_retry_at',
  'API-012 retry scheduling is durable'
);
select has_column(
  'public', 'sync_state', 'consecutive_failures',
  'API-012 retry attempts are durable'
);
select has_column(
  'public', 'sync_state', 'needs_login_repair',
  'API-012 repair state is durable'
);select has_column(
  'public', 'sync_state', 'last_failure_at',
  'API-012 last failure time is durable'
);
select has_column(
  'public', 'sync_state', 'current_request_id',
  'API-012 internal request identity is durable'
);select has_column(
  'public', 'sync_state', 'last_failure_request_id',
  'API-012 internal failure request identity is durable'
);
select has_column(
  'public', 'sync_state', 'provider_request_id',
  'API-012 provider request identity is durable'
);
select ok(
  not has_table_privilege('authenticated', 'public.sync_state', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.plaid_items', 'access_token_ciphertext', 'SELECT'),
  'API-012 token and state mutation boundaries stay service-only'
);


-- GH-5 regression: Plaid returns activity for every account on an Item,
-- including accounts the member never linked. Those rows must be skipped, not
-- fatal, or the institution can never complete a sync.
update public.sync_state set cursor = 'pre-unlinked-page', status = 'succeeded',
  error_code = null, error_message = null, next_retry_at = null, consecutive_failures = 0,
  current_request_id = null, current_trigger = null, claim_started_at = null
where plaid_item_id = '83000000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.claim_plaid_sync('83000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000009','nightly')$$,
  'API-013 the Item is claimed for an unlinked-account page'
);
select lives_ok(
  $$select public.commit_plaid_sync(
    '83000000-0000-4000-8000-000000000001',
    '85000000-0000-4000-8000-000000000009',
    'pre-unlinked-page',
    'post-unlinked-page',
    'provider-request-unlinked',
    '[
      {"transactionId":"linked-tx","accountId":"provider-chequing","amount":19.99,"currencyCode":"CAD","authorizedDate":null,"date":"2026-08-12","merchantName":"Linked Store","name":"Linked Store","pending":false,"pendingTransactionId":null,"payload":{}},
      {"transactionId":"unlinked-tx","accountId":"provider-never-linked","amount":31.50,"currencyCode":"CAD","authorizedDate":null,"date":"2026-08-12","merchantName":"Investment Fee","name":"Investment Fee","pending":false,"pendingTransactionId":null,"payload":{}}
    ]'::jsonb,
    '[{"transactionId":"unlinked-modified","accountId":"provider-never-linked","amount":5.00,"currencyCode":"CAD","authorizedDate":null,"date":"2026-08-12","merchantName":"Investment Fee","name":"Investment Fee","pending":false,"pendingTransactionId":null,"payload":{}}]'::jsonb,
    '[]'::jsonb
  )$$,
  'API-013 a page containing unlinked accounts commits instead of raising'
);
select is(
  (select count(*)::integer from public.transactions where plaid_transaction_id = 'linked-tx'),
  1,
  'API-013 the linked account transaction is applied'
);
select is(
  (select count(*)::integer from public.transactions where plaid_transaction_id in ('unlinked-tx','unlinked-modified')),
  0,
  'API-013 unlinked account rows are skipped, not stored'
);
select is(
  (select status::text from public.sync_state where plaid_item_id = '83000000-0000-4000-8000-000000000001'),
  'succeeded',
  'API-013 the sync succeeds despite unlinked account activity'
);

select * from finish();
rollback;


