begin;
set local search_path = public, extensions;
select no_plan();

-- GH-11 fixtures: one linker, a workspace owner who did not link the Items,
-- and a departing linker. Every change is rollback-only.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('11000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','linker-gh11@example.test','',now(),'{}','{}',now(),now()),
('11000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-gh11@example.test','',now(),'{}','{}',now(),now()),
('11000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','departing-gh11@example.test','',now(),'{}','{}',now(),now());
insert into public.profiles(id,display_name) values
('11000000-0000-4000-8000-000000000001','Connection Linker'),
('11000000-0000-4000-8000-000000000002','Family Owner'),
('11000000-0000-4000-8000-000000000003','Departing Linker');
insert into public.workspaces(id,singleton_key,name,owner_profile_id)
values ('12000000-0000-4000-8000-000000000001',true,'GH-11 Household','11000000-0000-4000-8000-000000000002');
insert into public.workspace_memberships(workspace_id,profile_id,role,status) values
('12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','member','active'),
('12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','owner','active'),
('12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','member','active');
set constraints all immediate;
set constraints all deferred;

insert into public.plaid_items(id,workspace_id,linked_by,plaid_item_id,institution_id,institution_name,access_token_ciphertext,access_token_key_version,status) values
('14000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','provider-item-manage','ins-maple','Maple Test Bank',decode('010203','hex'),1,'active'),
('14000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','provider-item-foreign-delete','ins-cedar','Cedar Credit Union',decode('020304','hex'),1,'active'),
('14000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','provider-item-keep','ins-spruce','Spruce Savings',decode('030405','hex'),1,'active'),
('14000000-0000-4000-8000-000000000004','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','provider-item-delete','ins-fir','Fir Bank',decode('040506','hex'),1,'active'),
('14000000-0000-4000-8000-000000000005','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','provider-item-depart','ins-birch','Birch Bank',decode('050607','hex'),1,'active'),
('14000000-0000-4000-8000-000000000006','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','provider-item-pending','ins-pending','Pending Review Bank',decode('060708','hex'),1,'pending');

insert into public.accounts(id,workspace_id,plaid_item_id,linked_by,provider_account_id,type,subtype,currency_code,mask,name,display_name,scope,owner_profile_id,lifecycle,read_only,archived_at) values
('15000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','provider-chequing-current','depository','chequing','CAD','1204','Everyday Chequing','Everyday Chequing','personal','11000000-0000-4000-8000-000000000001','live',false,null),
('15000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','provider-savings-absent','depository','savings','CAD','4410','Family Savings','Family Savings','family',null,'live',false,null),
('15000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000001','provider-other-deselected','depository','savings','CAD','9988','Other Item Savings','Other Item Savings','personal','11000000-0000-4000-8000-000000000001','deselected',true,now()),
('15000000-0000-4000-8000-000000000004','12000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000001','provider-keep','credit','credit_card','CAD','3322','Keep History Card','Keep History Card','family',null,'live',false,null),
('15000000-0000-4000-8000-000000000005','12000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000004','11000000-0000-4000-8000-000000000001','provider-delete','depository','chequing','CAD','5511','Delete Data Chequing','Delete Data Chequing','personal','11000000-0000-4000-8000-000000000001','live',false,null),
('15000000-0000-4000-8000-000000000006','12000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000005','11000000-0000-4000-8000-000000000003','provider-depart-personal','depository','chequing','CAD','6655','Departing Personal','Departing Personal','personal','11000000-0000-4000-8000-000000000003','live',false,null),
('15000000-0000-4000-8000-000000000007','12000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000005','11000000-0000-4000-8000-000000000003','provider-depart-family','depository','savings','CAD','7766','Departing Shared','Departing Shared','family',null,'live',false,null);

insert into public.transactions(id,workspace_id,account_id,plaid_transaction_id,amount,transaction_date,name,pending) values
('16000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001','manage-personal-tx',25.00,'2026-08-10','Manage Personal',false),
('16000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000002','manage-family-tx',35.00,'2026-08-10','Manage Family',false),
('16000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000003','foreign-delete-tx',45.00,'2026-08-10','Other Item',false),
('16000000-0000-4000-8000-000000000004','12000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000004','keep-tx',55.00,'2026-08-10','Keep History',false),
('16000000-0000-4000-8000-000000000005','12000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000005','delete-tx',65.00,'2026-08-10','Delete Graph',false),
('16000000-0000-4000-8000-000000000006','12000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000006','depart-personal-tx',75.00,'2026-08-10','Depart Personal',false),
('16000000-0000-4000-8000-000000000007','12000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000007','depart-family-tx',85.00,'2026-08-10','Depart Family',false);
insert into public.transaction_metadata(transaction_id,workspace_id,updated_by,scope,owner_profile_id) values
('16000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','personal','11000000-0000-4000-8000-000000000001'),
('16000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','family',null),
('16000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','personal','11000000-0000-4000-8000-000000000001'),
('16000000-0000-4000-8000-000000000004','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','family',null),
('16000000-0000-4000-8000-000000000005','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','personal','11000000-0000-4000-8000-000000000001'),
('16000000-0000-4000-8000-000000000006','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','personal','11000000-0000-4000-8000-000000000003'),
('16000000-0000-4000-8000-000000000007','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','family',null);
insert into public.sync_state(plaid_item_id,cursor,status,last_success_at) values
('14000000-0000-4000-8000-000000000001','manage-cursor','succeeded',now()),
('14000000-0000-4000-8000-000000000003','keep-cursor','succeeded',now()),
('14000000-0000-4000-8000-000000000004','delete-cursor','succeeded',now()),
('14000000-0000-4000-8000-000000000005','depart-cursor','succeeded',now());

-- API-002: linker ownership is stronger than Family ownership.
select throws_ok(
  $$select public.change_plaid_account_visibility('14000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','family',true)$$,
  '42501','forbidden','API-002 a workspace owner cannot manage an Item linked by another active member'
);
select is((select scope::text from public.accounts where id='15000000-0000-4000-8000-000000000001'),'personal','API-002 rejected owner mutation has no account side effect');

-- API-003 security regression: a browser role cannot forge the transaction-local
-- coordination setting to bypass either metadata immutability or account/metadata
-- privacy-domain consistency. The setting itself is not an authorization token.
set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('app.plaid_visibility_account','15000000-0000-4000-8000-000000000001',true);
select throws_ok(
  $$update public.transaction_metadata set scope='family',owner_profile_id=null where transaction_id='16000000-0000-4000-8000-000000000001'$$,
  '23514',null,'API-003 authenticated set_config cannot authorize direct transaction-metadata scope mutation'
);
select throws_ok(
  $$update public.accounts set scope='family',owner_profile_id=null where id='15000000-0000-4000-8000-000000000001'$$,
  '42501',null,'API-003 authenticated set_config cannot authorize direct account scope mutation'
);
reset role;
select set_config('app.plaid_visibility_account','',true);
select ok(
  (select scope='personal' and owner_profile_id='11000000-0000-4000-8000-000000000001' from public.accounts where id='15000000-0000-4000-8000-000000000001')
  and (select scope='personal' and owner_profile_id='11000000-0000-4000-8000-000000000001' from public.transaction_metadata where transaction_id='16000000-0000-4000-8000-000000000001'),
  'API-003 forged transition setting leaves both privacy-domain rows unchanged'
);

-- Pending review Items are not active connections and every management RPC
-- rejects them before mutation or account creation.
select throws_ok(
  $$select public.change_plaid_account_visibility('14000000-0000-4000-8000-000000000006','15000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','family',true)$$,
  '55000',null,'API-002 pending Item cannot enter visibility management'
);
select throws_ok(
  $$select public.reconcile_plaid_accounts('14000000-0000-4000-8000-000000000006','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','[{"providerAccountId":"must-not-create","name":"Pending Candidate","mask":"1111","type":"depository","kind":"chequing","eligible":true}]'::jsonb,'{}'::uuid[])$$,
  '55000',null,'API-007 pending Item cannot reconcile a provider account set'
);
select throws_ok(
  $$select public.finalize_plaid_disconnect('14000000-0000-4000-8000-000000000006','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','delete_data')$$,
  '55000',null,'API-009 pending Item cannot enter disconnect finalization'
);
select ok(
  not exists(select 1 from public.accounts where plaid_item_id='14000000-0000-4000-8000-000000000006')
  and exists(select 1 from public.plaid_items where id='14000000-0000-4000-8000-000000000006' and status='pending' and disconnected_at is null and access_token_ciphertext=decode('060708','hex')),
  'API-007 pending rejection creates no account and preserves pending provider material for activation only'
);
-- API-003: acknowledgement is a hard transaction boundary.
select throws_ok(
  $$select public.change_plaid_account_visibility('14000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','family',false)$$,
  '22023','retroactive acknowledgement required','API-003 missing visibility acknowledgement is rejected'
);
select ok(
  (select scope='personal' and owner_profile_id='11000000-0000-4000-8000-000000000001' from public.accounts where id='15000000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.audit_events where action='plaid_account.visibility_changed'),
  'API-003 rejection changes neither scope nor audit history'
);

-- API-004: Personal -> Family updates account, dependent metadata, and audit atomically.
set local role service_role;
select lives_ok(
  $$select public.change_plaid_account_visibility('14000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','family',true)$$,
  'API-004 linker changes a Personal account to Family through the service-role-only RPC'
);
reset role;
select ok(
  (select scope='family' and owner_profile_id is null from public.accounts where id='15000000-0000-4000-8000-000000000001')
  and (select scope='family' and owner_profile_id is null from public.transaction_metadata where transaction_id='16000000-0000-4000-8000-000000000001')
  and exists(select 1 from public.audit_events where action='plaid_account.visibility_changed' and actor_profile_id='11000000-0000-4000-8000-000000000001' and target_id='15000000-0000-4000-8000-000000000001' and details @> '{"oldScope":"personal","newScope":"family","itemId":"14000000-0000-4000-8000-000000000001"}'::jsonb and details ? 'changedAt'),
  'API-004 account, dashboard/budget metadata, and audit record commit together'
);

-- API-005: Family -> Personal restores linker ownership everywhere and audits it.
set local role service_role;
select lives_ok(
  $$select public.change_plaid_account_visibility('14000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','personal',true)$$,
  'API-005 linker changes the same Family account back to Personal'
);
reset role;
select ok(
  (select scope='personal' and owner_profile_id='11000000-0000-4000-8000-000000000001' from public.accounts where id='15000000-0000-4000-8000-000000000001')
  and (select scope='personal' and owner_profile_id='11000000-0000-4000-8000-000000000001' from public.transaction_metadata where transaction_id='16000000-0000-4000-8000-000000000001')
  and exists(select 1 from public.audit_events where action='plaid_account.visibility_changed' and details @> '{"oldScope":"family","newScope":"personal"}'::jsonb),
  'API-005 account, dependent metadata, and reverse audit record commit together'
);

-- API-007: immutable provider identity restores an old account, creates a new
-- eligible CAD account, and deselects an absent local account without ID reuse.
update public.accounts set lifecycle='deselected',read_only=true,archived_at=now()
where id='15000000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.reconcile_plaid_accounts(
    '14000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001',
    '[{"providerAccountId":"provider-chequing-current","name":"Everyday Chequing Returned","officialName":"Current identity","mask":"1204","type":"depository","kind":"chequing","eligible":true,"availableBalanceCents":120000,"currentBalanceCents":125000,"balanceUpdatedAt":"2026-08-12T18:30:00Z"},{"providerAccountId":"provider-credit-brand-new","name":"New Credit","officialName":"New Credit Account","mask":"9090","type":"credit","kind":"credit_card","eligible":true,"availableBalanceCents":50000,"currentBalanceCents":25000,"creditLimitCents":75000,"balanceUpdatedAt":"2026-08-12T18:30:00Z"}]'::jsonb,'{}'::uuid[]
  )$$,
  'API-007 fresh provider account set reconciles atomically'
);
select ok(
  (select id='15000000-0000-4000-8000-000000000001' and lifecycle='live' and not read_only and archived_at is null from public.accounts where provider_account_id='provider-chequing-current')
  and exists(select 1 from public.accounts where provider_account_id='provider-credit-brand-new' and id not in ('15000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000002') and subtype='credit_card' and lifecycle='live')
  and (select lifecycle='deselected' and read_only and archived_at is not null from public.accounts where id='15000000-0000-4000-8000-000000000002'),
  'API-007 returned identity retains its ID, new identity gets a new ID, and absent account becomes read-only'
);

-- API-008: deletion IDs must name deselected accounts on this exact Item.
select throws_ok(
  $$select public.reconcile_plaid_accounts('14000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','[]'::jsonb,array['15000000-0000-4000-8000-000000000003']::uuid[])$$,
  '22023','invalid deselected account','API-008 cannot delete a deselected account belonging to another Item'
);
select ok(
  exists(select 1 from public.accounts where id='15000000-0000-4000-8000-000000000003')
  and exists(select 1 from public.transactions where id='16000000-0000-4000-8000-000000000003'),
  'API-008 rejected cross-Item deletion preserves the other Item graph'
);
select lives_ok(
  $$select public.reconcile_plaid_accounts('14000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','[{"providerAccountId":"provider-chequing-current","name":"Everyday Chequing Returned","officialName":"Current identity","mask":"1204","type":"depository","kind":"chequing","eligible":true}]'::jsonb,array['15000000-0000-4000-8000-000000000002']::uuid[])$$,
  'API-008 explicitly deletes a validated deselected account on the target Item'
);
select ok(
  not exists(select 1 from public.accounts where id='15000000-0000-4000-8000-000000000002')
  and not exists(select 1 from public.transactions where id='16000000-0000-4000-8000-000000000002')
  and not exists(select 1 from public.transaction_metadata where transaction_id='16000000-0000-4000-8000-000000000002'),
  'API-008 scoped deletion removes only that deselected account data'
);

-- API-009: recent-confirmation state is service-only and cannot be forged by a browser role.
select ok(
  not has_table_privilege('authenticated','public.recent_auth_confirmations','INSERT')
  and not has_table_privilege('authenticated','public.recent_auth_confirmations','UPDATE')
  and not has_table_privilege('authenticated','public.recent_auth_confirmations','DELETE'),
  'API-009 browser callers cannot forge the recent-password confirmation gate'
);

-- API-010 disconnect recovery: the provider boundary is durably bracketed,
-- ambiguous attempts never reactivate, and confirmed provider removal is adoptable.
set local role service_role;
select is(
  public.claim_plaid_disconnect('14000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','keep_history','17000000-0000-4000-8000-000000000001'),
  'claimed','API-010 first disconnect caller owns a claimed provider-removal attempt'
);
select throws_ok(
  $$select public.claim_plaid_disconnect('14000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','keep_history','17000000-0000-4000-8000-000000000002')$$,
  '55P03','disconnect in progress','API-010 concurrent caller cannot cross the provider boundary'
);
select throws_ok(
  $$select public.finalize_claimed_plaid_disconnect('14000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','keep_history','17000000-0000-4000-8000-000000000001')$$,
  '55000','provider removal not confirmed','API-010 claimed-only attempt cannot finalize without provider proof'
);
select lives_ok(
  $$select public.begin_plaid_disconnect_removal('14000000-0000-4000-8000-000000000003','17000000-0000-4000-8000-000000000001')$$,
  'API-010 removal_started is persisted immediately before provider invocation'
);
select ok(
  exists(select 1 from public.plaid_items where id='14000000-0000-4000-8000-000000000003' and status='error' and disconnect_claim_phase='removal_started' and disconnect_removal_started_at is not null and disconnect_provider_removed_at is null),
  'API-010 removal_started leaves the Item fail-closed with durable start time'
);
select lives_ok(
  $$select public.release_plaid_disconnect('14000000-0000-4000-8000-000000000003','17000000-0000-4000-8000-000000000001')$$,
  'API-013 ambiguous provider failure may request release'
);
select ok(
  exists(select 1 from public.plaid_items where id='14000000-0000-4000-8000-000000000003' and status='error' and disconnect_claim_id='17000000-0000-4000-8000-000000000001' and disconnect_claim_phase='removal_started'),
  'API-013 started provider attempt cannot restore prior active state or clear ambiguity'
);
update public.plaid_items set disconnect_claimed_at=now()-interval '6 minutes'
where id='14000000-0000-4000-8000-000000000003';
select is(
  public.claim_plaid_disconnect('14000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','keep_history','17000000-0000-4000-8000-000000000002'),
  'claimed','API-010 stale ambiguous attempt is reclaimable only as another fail-closed provider retry'
);
select ok(
  exists(select 1 from public.plaid_items where id='14000000-0000-4000-8000-000000000003' and status='error' and disconnect_claim_id='17000000-0000-4000-8000-000000000002' and disconnect_claim_phase='claimed' and disconnect_claim_previous_status='active'),
  'API-010 stale adoption never reactivates the Item before retry completes'
);
select lives_ok(
  $$select public.begin_plaid_disconnect_removal('14000000-0000-4000-8000-000000000003','17000000-0000-4000-8000-000000000002')$$,
  'API-010 adopted retry durably records its provider-removal start'
);
select lives_ok(
  $$select public.mark_plaid_disconnect_provider_removed('14000000-0000-4000-8000-000000000003','17000000-0000-4000-8000-000000000002')$$,
  'API-010 provider success is durably marked before local finalization'
);
select ok(
  exists(select 1 from public.plaid_items where id='14000000-0000-4000-8000-000000000003' and status='error' and disconnect_claim_phase='provider_removed' and disconnect_provider_removed_at is not null),
  'API-010 provider_removed proof remains fail-closed until finalization'
);
select throws_ok(
  $$select public.finalize_claimed_plaid_disconnect('14000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','keep_history','17000000-0000-4000-8000-000000000099')$$,
  '40001','disconnect claim lost','API-010 simulated wrong/failing finalize leaves provider_removed proof durable'
);
select is(
  public.claim_plaid_disconnect('14000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','keep_history','17000000-0000-4000-8000-000000000003'),
  'provider_removed','API-010 retry adopts provider_removed proof and must skip a second provider call'
);
select ok(
  exists(select 1 from public.plaid_items where id='14000000-0000-4000-8000-000000000003' and status='error' and disconnect_claim_id='17000000-0000-4000-8000-000000000003' and disconnect_claim_phase='provider_removed' and disconnect_provider_removed_at is not null),
  'API-010 provider-removed adoption transfers claim ownership without erasing proof or reactivating'
);
reset role;
-- API-010: keep-history disconnect retains financial rows but makes them
-- disconnected/read-only, clears synchronization, and destroys token material.
set local role service_role;
select lives_ok(
  $$select public.finalize_claimed_plaid_disconnect('14000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','keep_history','17000000-0000-4000-8000-000000000003')$$,
  'API-010 adopted provider-removed claim finalizes without another provider removal'
);
reset role;
select ok(
  exists(select 1 from public.accounts where id='15000000-0000-4000-8000-000000000004' and lifecycle='disconnected' and read_only and archived_at is not null)
  and exists(select 1 from public.transactions where id='16000000-0000-4000-8000-000000000004')
  and exists(select 1 from public.transaction_metadata where transaction_id='16000000-0000-4000-8000-000000000004')
  and exists(select 1 from public.sync_state where plaid_item_id='14000000-0000-4000-8000-000000000003' and status='idle' and cursor is null)
  and exists(select 1 from public.plaid_items where id='14000000-0000-4000-8000-000000000003' and status='revoked' and disconnected_at is not null and access_token_ciphertext=decode('00','hex')),
  'API-010 history is retained read-only while provider access and future sync are disabled'
);

-- API-011: delete-data removes only the target Item's local graph.
set local role service_role;
select lives_ok(
  $disconnect$do $$
  begin
    perform public.claim_plaid_disconnect(
      '14000000-0000-4000-8000-000000000004',
      '12000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      'delete_data',
      '17000000-0000-4000-8000-000000000004'
    );
    perform public.begin_plaid_disconnect_removal(
      '14000000-0000-4000-8000-000000000004',
      '17000000-0000-4000-8000-000000000004'
    );
    perform public.mark_plaid_disconnect_provider_removed(
      '14000000-0000-4000-8000-000000000004',
      '17000000-0000-4000-8000-000000000004'
    );
    perform public.finalize_claimed_plaid_disconnect(
      '14000000-0000-4000-8000-000000000004',
      '12000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      'delete_data',
      '17000000-0000-4000-8000-000000000004'
    );
  end $$;$disconnect$,
  'API-011 claimed delete-data finalization succeeds after durable provider-removal proof'
);
reset role;
select ok(
  not exists(select 1 from public.accounts where plaid_item_id='14000000-0000-4000-8000-000000000004')
  and not exists(select 1 from public.transactions where id='16000000-0000-4000-8000-000000000005')
  and not exists(select 1 from public.transaction_metadata where transaction_id='16000000-0000-4000-8000-000000000005')
  and not exists(select 1 from public.sync_state where plaid_item_id='14000000-0000-4000-8000-000000000004')
  and exists(select 1 from public.accounts where id='15000000-0000-4000-8000-000000000004'),
  'API-011 target graph is deleted while another Item remains intact'
);

-- API-012: member departure removes Personal history and retains formerly
-- shared Family history as disconnected/read-only while revoking the Item.
select lives_ok(
  $$select private.cleanup_member('12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003')$$,
  'API-012 membership cleanup revokes every Item linked by the departing member'
);
select ok(
  not exists(select 1 from public.accounts where id='15000000-0000-4000-8000-000000000006')
  and not exists(select 1 from public.transactions where id='16000000-0000-4000-8000-000000000006')
  and exists(select 1 from public.accounts where id='15000000-0000-4000-8000-000000000007' and lifecycle='disconnected' and read_only)
  and exists(select 1 from public.transactions where id='16000000-0000-4000-8000-000000000007')
  and exists(select 1 from public.plaid_items where id='14000000-0000-4000-8000-000000000005' and status='revoked' and disconnected_at is not null and access_token_ciphertext=decode('00','hex')),
  'API-012 Personal history is removed and already-shared Family history is preserved read-only'
);

-- API-014: repeated finalization is idempotent and cannot erase retained history.
select lives_ok(
  $$select public.finalize_plaid_disconnect('14000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','keep_history')$$,
  'API-014 repeating disconnect on an already-revoked Item succeeds'
);
select is(
  public.claim_plaid_disconnect('14000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','keep_history','17000000-0000-4000-8000-000000000003'),
  'disconnected','API-014 revoked Item reports idempotent completion without acquiring another claim'
);
select ok(
  exists(select 1 from public.plaid_items where id='14000000-0000-4000-8000-000000000003' and status='revoked' and disconnect_claim_id is null),
  'API-014 idempotent revoked claim path creates no second provider-removal ownership'
);select ok(
  exists(select 1 from public.accounts where id='15000000-0000-4000-8000-000000000004' and lifecycle='disconnected')
  and exists(select 1 from public.transactions where id='16000000-0000-4000-8000-000000000004'),
  'API-014 repeat disconnect preserves the original keep-history result'
);

select ok(
  not has_function_privilege('authenticated','public.claim_plaid_disconnect(uuid,uuid,uuid,text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.begin_plaid_disconnect_removal(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.mark_plaid_disconnect_provider_removed(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.release_plaid_disconnect(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.finalize_claimed_plaid_disconnect(uuid,uuid,uuid,text,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.claim_plaid_disconnect(uuid,uuid,uuid,text,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.begin_plaid_disconnect_removal(uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.mark_plaid_disconnect_provider_removed(uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.release_plaid_disconnect(uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.finalize_claimed_plaid_disconnect(uuid,uuid,uuid,text,uuid)','EXECUTE'),
  'API-010 disconnect claim acquire/release/finalize primitives are service-role only'
);
-- API-013 and API-014 security surface: lifecycle primitives are trusted-server
-- only, fixed-search-path security definers with no client token-return surface.
select ok(
  not has_function_privilege('authenticated','public.change_plaid_account_visibility(uuid,uuid,uuid,uuid,public.data_scope,boolean)','EXECUTE')
  and not has_function_privilege('authenticated','public.reconcile_plaid_accounts(uuid,uuid,uuid,jsonb,uuid[])','EXECUTE')
  and not has_function_privilege('authenticated','public.finalize_plaid_disconnect(uuid,uuid,uuid,text)','EXECUTE')
  and has_function_privilege('service_role','public.change_plaid_account_visibility(uuid,uuid,uuid,uuid,public.data_scope,boolean)','EXECUTE')
  and has_function_privilege('service_role','public.reconcile_plaid_accounts(uuid,uuid,uuid,jsonb,uuid[])','EXECUTE')
  and has_function_privilege('service_role','public.finalize_plaid_disconnect(uuid,uuid,uuid,text)','EXECUTE'),
  'API-013 lifecycle mutation primitives expose no browser-callable secret-bearing surface'
);
select ok(
  (select prosecdef and coalesce(array_to_string(proconfig,','),'') ~ 'search_path=' from pg_proc where oid='public.change_plaid_account_visibility(uuid,uuid,uuid,uuid,public.data_scope,boolean)'::regprocedure)
  and (select prosecdef and coalesce(array_to_string(proconfig,','),'') ~ 'search_path=' from pg_proc where oid='public.reconcile_plaid_accounts(uuid,uuid,uuid,jsonb,uuid[])'::regprocedure)
  and (select prosecdef and coalesce(array_to_string(proconfig,','),'') ~ 'search_path=' from pg_proc where oid='public.finalize_plaid_disconnect(uuid,uuid,uuid,text)'::regprocedure),
  'API-013 lifecycle functions resolve objects through fixed search paths'
);

select * from finish();
rollback;
