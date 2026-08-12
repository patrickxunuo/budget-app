begin;
set local search_path = public, extensions;
select no_plan();

-- Privileged fixture setup: four realistic auth identities and one household.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('a0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@example.test','',now(),'{}','{}',now(),now()),
('a0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','member@example.test','',now(),'{}','{}',now(),now()),
('a0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','inactive@example.test','',now(),'{}','{}',now(),now()),
('a0000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','invited@example.test','',now(),'{}','{}',now(),now()),
('a0000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','outsider@example.test','',now(),'{}','{}',now(),now());
insert into public.profiles(id,display_name) values
('a0000000-0000-0000-0000-000000000001','Owner'),('a0000000-0000-0000-0000-000000000002','Member'),
('a0000000-0000-0000-0000-000000000003','Inactive'),('a0000000-0000-0000-0000-000000000004','Invited'),
('a0000000-0000-0000-0000-000000000005','Outsider');
insert into public.workspaces(id,singleton_key,name,owner_profile_id) values
('b0000000-0000-0000-0000-000000000001',true,'RLS Household','a0000000-0000-0000-0000-000000000001');
insert into public.workspace_memberships(workspace_id,profile_id,role,status) values
('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','owner','active'),
('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','member','active'),
('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003','member','inactive'),
('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000004','member','invited');
insert into public.categories(id,workspace_id,created_by,name,color,scope,owner_profile_id) values
('c0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Family Seed','#123456','family',null),
('c0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','Member Personal','#654321','personal','a0000000-0000-0000-0000-000000000002');
insert into public.plaid_items(id,workspace_id,linked_by,plaid_item_id,institution_id,institution_name,access_token_ciphertext,access_token_key_version,status) values
('d0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','rls-item','ins_rls','RLS Bank',decode('cafe','hex'),1,'active');
insert into public.accounts(id,workspace_id,plaid_item_id,linked_by,provider_account_id,type,subtype,currency_code,mask,name,display_name,scope,owner_profile_id) values
('e0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','rls-account','depository','chequing','CAD','1234','Chequing','Household Chequing','family',null),
('e0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','rls-personal-account','depository','savings','CAD','5678','Savings','Private Savings','personal','a0000000-0000-0000-0000-000000000002');
insert into public.transactions(id,workspace_id,account_id,plaid_transaction_id,amount,currency_code,transaction_date,name,pending,provider_payload) values
('f0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','rls-txn',12.34,'CAD',current_date,'Grocer',false,'{}'),
('f0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002','rls-personal-txn',45.67,'CAD',current_date,'Private Purchase',false,'{}');
insert into public.sync_state(plaid_item_id, cursor, status) values
('d0000000-0000-0000-0000-000000000001', 'cursor-1', 'succeeded');
insert into public.transaction_metadata(transaction_id,workspace_id,updated_by,scope,owner_profile_id,note,excluded) values
('f0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','family',null,'Family note',false),
('f0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','personal','a0000000-0000-0000-0000-000000000002','Private note',false);
insert into public.manual_entries(id,workspace_id,created_by,scope,owner_profile_id,amount,currency_code,entry_date,description,category_id) values
('f2000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','family',null,10,'CAD',current_date,'Family manual','c0000000-0000-0000-0000-000000000001'),
('f2000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','personal','a0000000-0000-0000-0000-000000000002',20,'CAD',current_date,'Private manual','c0000000-0000-0000-0000-000000000002');
insert into public.merchant_rules(id,workspace_id,created_by,merchant_match,category_id,scope,owner_profile_id) values
('f3000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','family merchant','c0000000-0000-0000-0000-000000000001','family',null),
('f3000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','private merchant','c0000000-0000-0000-0000-000000000002','personal','a0000000-0000-0000-0000-000000000002');
insert into public.budgets(id,workspace_id,created_by,category_id,amount,currency_code,start_date,end_date,scope,owner_profile_id) values
('f4000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',100,'CAD',current_date,current_date + 30,'family',null),
('f4000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000002',50,'CAD',current_date,current_date + 30,'personal','a0000000-0000-0000-0000-000000000002');
insert into public.audit_events(id,workspace_id,actor_profile_id,action,target_type,target_id,scope,owner_profile_id,details) values
('f1000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','seed.family','category','c0000000-0000-0000-0000-000000000001','family',null,'{}'),
('f1000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','seed.personal','category','c0000000-0000-0000-0000-000000000002','personal','a0000000-0000-0000-0000-000000000002','{}');

-- DB-002: every application table enables RLS, and anon has no privileges.
select ok(not exists(
  select 1 from (values ('profiles'),('workspaces'),('workspace_memberships'),('invitations'),('plaid_items'),('accounts'),('transactions'),('transaction_metadata'),('manual_entries'),('categories'),('merchant_rules'),('budgets'),('sync_state'),('audit_events')) v(tab)
  left join pg_class c on c.relname=v.tab left join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
  where c.oid is null or not c.relrowsecurity
), 'DB-002 all public application tables have RLS enabled');
select ok(not exists(
  select 1 from (values ('profiles'),('workspaces'),('workspace_memberships'),('invitations'),('plaid_items'),('accounts'),('transactions'),('transaction_metadata'),('manual_entries'),('categories'),('merchant_rules'),('budgets'),('sync_state'),('audit_events')) v(tab)
  where has_table_privilege('anon',format('public.%I',v.tab),'SELECT') or has_table_privilege('anon',format('public.%I',v.tab),'INSERT') or has_table_privilege('anon',format('public.%I',v.tab),'UPDATE') or has_table_privilege('anon',format('public.%I',v.tab),'DELETE')
), 'DB-002 anon has no table privileges');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}',true);

-- DB-005: both active members see Family rows.
select results_eq($$select count(*)::bigint from public.categories where id='c0000000-0000-0000-0000-000000000001'$$,array[1::bigint],'DB-005 active owner reads Family records');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select results_eq($$select count(*)::bigint from public.categories where id='c0000000-0000-0000-0000-000000000001'$$,array[1::bigint],'DB-005 active member reads Family records');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select results_eq($$select count(*)::bigint from public.categories where id='c0000000-0000-0000-0000-000000000001'$$,array[0::bigint],'DB-005 inactive member cannot read Family records');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
select results_eq($$select count(*)::bigint from public.categories where id='c0000000-0000-0000-0000-000000000001'$$,array[0::bigint],'DB-005 invited member cannot read Family records');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
select results_eq($$select count(*)::bigint from public.categories where id='c0000000-0000-0000-0000-000000000001'$$,array[0::bigint],'DB-005 outsider cannot read Family records');

-- DB-006: Personal data is owner-only, even from the family owner.
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select results_eq($$select count(*)::bigint from public.categories where id='c0000000-0000-0000-0000-000000000002'$$,array[1::bigint],'DB-006 Personal record owner can read it');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select results_eq($$select count(*)::bigint from public.categories where id='c0000000-0000-0000-0000-000000000002'$$,array[0::bigint],'DB-006 workspace owner cannot read another member Personal record');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select results_eq($$select count(*)::bigint from public.categories where id='c0000000-0000-0000-0000-000000000002'$$,array[0::bigint],'DB-006 non-owner member cannot read another Personal record');

-- DB-007: linker-only management and ciphertext confidentiality.
select ok(not has_column_privilege('authenticated','public.plaid_items','access_token_ciphertext','SELECT'),'DB-007 authenticated cannot select token ciphertext');
select ok(not has_column_privilege('authenticated','public.plaid_items','access_token_key_version','SELECT'),'DB-007 authenticated cannot select token key version');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select results_eq($$select count(*)::bigint from public.plaid_items where id='d0000000-0000-0000-0000-000000000001'$$,array[1::bigint],'DB-007 linker reads their Plaid Item');
select results_eq($$select count(*)::bigint from public.sync_state where plaid_item_id='d0000000-0000-0000-0000-000000000001'$$,array[1::bigint],'DB-007 linker reads their synchronization state');
select throws_ok($$update public.plaid_items set institution_name='Tampered Bank' where id='d0000000-0000-0000-0000-000000000001'$$,'42501',null,'DB-007 browser linker cannot mutate immutable provider identity columns');
select results_eq($$update public.accounts set display_name='Linker renamed' where id='e0000000-0000-0000-0000-000000000001' returning display_name$$,array['Linker renamed'::text],'DB-007 linker manages allowed account metadata');
select throws_ok($$update public.accounts set scope='personal',owner_profile_id='a0000000-0000-0000-0000-000000000002' where id='e0000000-0000-0000-0000-000000000001'$$,'42501',null,'DB-007 browser linker cannot bypass validated account privacy transitions');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select results_eq($$select count(*)::bigint from public.plaid_items where id='d0000000-0000-0000-0000-000000000001'$$,array[0::bigint],'DB-007 another active member cannot read linker-owned Plaid Item identity');
select results_eq($$select count(*)::bigint from public.sync_state where plaid_item_id='d0000000-0000-0000-0000-000000000001'$$,array[0::bigint],'DB-007 another active member cannot read linker-owned synchronization state');
select results_eq($$update public.accounts set display_name='Owner takeover' where id='e0000000-0000-0000-0000-000000000001' returning display_name$$,array[]::text[],'DB-007 another active member cannot manage linker-owned account state');

-- DB-008: browser users cannot mutate provider mirrors; privileged setup wrote them.
select ok(not has_table_privilege('authenticated','public.transactions','INSERT') and not has_table_privilege('authenticated','public.transactions','UPDATE') and not has_table_privilege('authenticated','public.transactions','DELETE'),'DB-008 authenticated cannot mutate Plaid transaction mirrors');
select ok(not has_table_privilege('authenticated','public.sync_state','INSERT') and not has_table_privilege('authenticated','public.sync_state','UPDATE') and not has_table_privilege('authenticated','public.sync_state','DELETE'),'DB-008 authenticated cannot write synchronization state');
select results_eq($$select count(*)::bigint from public.transactions where id='f0000000-0000-0000-0000-000000000001'$$,array[1::bigint],'DB-008 service-role-style privileged setup can write synchronization data');
select throws_ok($$insert into public.transactions(workspace_id,account_id,plaid_transaction_id,amount,currency_code,transaction_date,name) values ('b0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','browser-insert',1,'CAD',current_date,'Browser Insert')$$,'42501',null,'DB-008 authenticated cannot insert provider transaction mirrors');
select throws_ok($$update public.transactions set amount=999 where id='f0000000-0000-0000-0000-000000000001'$$,'42501',null,'DB-008 authenticated cannot update provider transaction mirrors');
select throws_ok($$delete from public.transactions where id='f0000000-0000-0000-0000-000000000001'$$,'42501',null,'DB-008 authenticated cannot delete provider transaction mirrors');
select throws_ok($$insert into public.sync_state(plaid_item_id,status) values ('d0000000-0000-0000-0000-000000000001','idle')$$,'42501',null,'DB-008 authenticated cannot insert synchronization state');
select throws_ok($$update public.sync_state set status='failed',error_code='browser' where plaid_item_id='d0000000-0000-0000-0000-000000000001'$$,'42501',null,'DB-008 authenticated cannot update synchronization state');
select throws_ok($$delete from public.sync_state where plaid_item_id='d0000000-0000-0000-0000-000000000001'$$,'42501',null,'DB-008 authenticated cannot delete synchronization state');
select throws_ok($$insert into public.audit_events(workspace_id,actor_profile_id,action,scope) values ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','browser.write','family')$$,'42501',null,'DB-008 authenticated cannot append audit events');
select throws_ok($$update public.audit_events set action='browser.update' where id='f1000000-0000-0000-0000-000000000001'$$,'42501',null,'DB-008 authenticated cannot update audit events');
select throws_ok($$delete from public.audit_events where id='f1000000-0000-0000-0000-000000000001'$$,'42501',null,'DB-008 authenticated cannot delete audit events');

-- DB-009: scoped tables expose only the authenticated mutations supported by
-- their domain workflow; categories archive and rule creation uses a narrow RPC.
select ok(
  has_table_privilege('authenticated','public.categories','SELECT,INSERT,UPDATE')
  and not has_table_privilege('authenticated','public.categories','DELETE')
  and has_table_privilege('authenticated','public.merchant_rules','SELECT,DELETE')
  and not has_table_privilege('authenticated','public.merchant_rules','INSERT,UPDATE')
  and not exists(
    select 1 from (values ('budgets'),('manual_entries'),('transaction_metadata')) v(tab)
    where not (has_table_privilege('authenticated',format('public.%I',v.tab),'SELECT') and has_table_privilege('authenticated',format('public.%I',v.tab),'INSERT') and has_table_privilege('authenticated',format('public.%I',v.tab),'UPDATE') and has_table_privilege('authenticated',format('public.%I',v.tab),'DELETE'))
  ), 'DB-009 scoped tables expose only supported authenticated mutations');
select ok(not exists(
  select 1 from (values ('budgets'),('manual_entries'),('transaction_metadata')) v(tab)
  where (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=v.tab and 'authenticated'=any(p.roles)) < 3
), 'DB-009 directly mutable scoped tables have authenticated read/write policies');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select lives_ok($$insert into public.categories(workspace_id,created_by,name,color,scope,owner_profile_id) values ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','Family Added','#111111','family',null)$$,'DB-009 active members create Family records');
select lives_ok($$update public.categories set color='#222222' where id='c0000000-0000-0000-0000-000000000001'$$,'DB-009 active members update Family records');
select throws_ok($$delete from public.categories where name='Family Added'$$,'42501',null,'DB-009 categories expose archive updates instead of destructive deletion');
select lives_ok($$insert into public.manual_entries(workspace_id,created_by,scope,amount,currency_code,entry_date,description) values ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','family',3,'CAD',current_date,'Temporary manual')$$,'DB-009 active members create Family manual entries');
select lives_ok($$update public.manual_entries set description='Updated family manual' where id='f2000000-0000-0000-0000-000000000001'$$,'DB-009 active members update Family manual entries');
select lives_ok($$delete from public.manual_entries where description='Temporary manual'$$,'DB-009 active members delete Family manual entries');
select throws_ok($$insert into public.merchant_rules(workspace_id,created_by,merchant_match,category_id,scope) values ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','temporary merchant','c0000000-0000-0000-0000-000000000001','family')$$,'42501',null,'DB-009 direct merchant-rule creation is denied in favor of the validating RPC');
select throws_ok($$update public.merchant_rules set priority=2 where id='f3000000-0000-0000-0000-000000000001'$$,'42501',null,'DB-009 direct Family rule updates are denied');
select lives_ok($$delete from public.merchant_rules where merchant_match='temporary merchant'$$,'DB-009 active members delete Family merchant rules');
select lives_ok($$insert into public.budgets(workspace_id,created_by,amount,currency_code,start_date,end_date,scope) values ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002',25,'CAD',current_date,current_date + 7,'family')$$,'DB-009 active members create Family budgets');
select lives_ok($$update public.budgets set amount=125 where id='f4000000-0000-0000-0000-000000000001'$$,'DB-009 active members update Family budgets');
select lives_ok($$delete from public.budgets where amount=25$$,'DB-009 active members delete Family budgets');
select lives_ok($$update public.transaction_metadata set note='Collaborative update',updated_by='a0000000-0000-0000-0000-000000000002' where transaction_id='f0000000-0000-0000-0000-000000000001'$$,'DB-009 active members update Family transaction metadata with accurate attribution');
select lives_ok($$delete from public.transaction_metadata where transaction_id='f0000000-0000-0000-0000-000000000001'$$,'DB-009 active members delete Family transaction metadata');
select lives_ok($$insert into public.transaction_metadata(transaction_id,workspace_id,updated_by,scope,note) values ('f0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','family','Restored metadata')$$,'DB-009 active members create Family transaction metadata');
select throws_ok($$update public.transaction_metadata set updated_by='a0000000-0000-0000-0000-000000000001' where transaction_id='f0000000-0000-0000-0000-000000000001'$$,'42501',null,'DB-009 collaborators cannot falsely attribute transaction metadata updates');
select throws_ok($$update public.transaction_metadata set scope='personal',owner_profile_id='a0000000-0000-0000-0000-000000000002',updated_by='a0000000-0000-0000-0000-000000000002' where transaction_id='f0000000-0000-0000-0000-000000000001'$$,'23514',null,'DB-009 collaborators cannot privatize shared transaction metadata');
select throws_ok($$update public.transaction_metadata set category_id='c0000000-0000-0000-0000-000000000002',updated_by='a0000000-0000-0000-0000-000000000002' where transaction_id='f0000000-0000-0000-0000-000000000001'$$,'23514',null,'DB-009 Family transaction metadata cannot reference a Personal category');
select throws_ok($$update public.transaction_metadata set category_id='c0000000-0000-0000-0000-000000000001',updated_by='a0000000-0000-0000-0000-000000000002' where transaction_id='f0000000-0000-0000-0000-000000000002'$$,'23514',null,'DB-009 Personal transaction metadata cannot reference a Family category');
select throws_ok($$insert into public.manual_entries(workspace_id,created_by,scope,amount,currency_code,entry_date,description,category_id) values ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','family',4,'CAD',current_date,'Bad family category','c0000000-0000-0000-0000-000000000002')$$,'23514',null,'DB-009 Family manual entries cannot reference a Personal category');
select throws_ok($$insert into public.manual_entries(workspace_id,created_by,scope,owner_profile_id,amount,currency_code,entry_date,description,category_id) values ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','personal','a0000000-0000-0000-0000-000000000002',4,'CAD',current_date,'Bad personal category','c0000000-0000-0000-0000-000000000001')$$,'23514',null,'DB-009 Personal manual entries cannot reference a Family category');
select throws_ok($$insert into public.merchant_rules(workspace_id,created_by,merchant_match,category_id,scope) values ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','bad family category','c0000000-0000-0000-0000-000000000002','family')$$,'42501',null,'DB-009 direct Family rule insertion is denied');
select throws_ok($$insert into public.merchant_rules(workspace_id,created_by,merchant_match,category_id,scope,owner_profile_id) values ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','bad personal category','c0000000-0000-0000-0000-000000000001','personal','a0000000-0000-0000-0000-000000000002')$$,'42501',null,'DB-009 direct Personal rule insertion is denied');
select throws_ok($$insert into public.budgets(workspace_id,created_by,category_id,amount,currency_code,start_date,end_date,scope) values ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000002',10,'CAD',current_date,current_date + 1,'family')$$,'23514',null,'DB-009 Family budgets cannot reference a Personal category');
select throws_ok($$insert into public.budgets(workspace_id,created_by,category_id,amount,currency_code,start_date,end_date,scope,owner_profile_id) values ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001',10,'CAD',current_date,current_date + 1,'personal','a0000000-0000-0000-0000-000000000002')$$,'23514',null,'DB-009 Personal budgets cannot reference a Family category');
select throws_ok($$update public.categories set scope='family',owner_profile_id=null where id='c0000000-0000-0000-0000-000000000002'$$,'23514',null,'DB-009 category authorization scope is immutable once referenced');
select lives_ok($$insert into public.categories(workspace_id,created_by,name,scope,owner_profile_id) values ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','Temporary Personal','personal','a0000000-0000-0000-0000-000000000002')$$,'DB-009 owners create Personal categories');
select lives_ok($$update public.categories set color='#abcdef' where name='Temporary Personal'$$,'DB-009 owners update Personal categories');
select lives_ok($$insert into public.manual_entries(workspace_id,created_by,scope,owner_profile_id,amount,currency_code,entry_date,description,category_id) select 'b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','personal','a0000000-0000-0000-0000-000000000002',7,'CAD',current_date,'Temporary private manual',id from public.categories where name='Temporary Personal'$$,'DB-009 owners create Personal manual entries');
select lives_ok($$update public.manual_entries set amount=8 where description='Temporary private manual'$$,'DB-009 owners update Personal manual entries');
select throws_ok($$insert into public.merchant_rules(workspace_id,created_by,merchant_match,category_id,scope,owner_profile_id) select 'b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','temporary private merchant',id,'personal','a0000000-0000-0000-0000-000000000002' from public.categories where name='Temporary Personal'$$,'42501',null,'DB-009 owners also use the validating RPC for Personal rules');
select throws_ok($$update public.merchant_rules set priority=3 where merchant_match='temporary private merchant'$$,'42501',null,'DB-009 direct Personal rule updates are denied');
select lives_ok($$insert into public.budgets(workspace_id,created_by,category_id,amount,currency_code,start_date,end_date,scope,owner_profile_id) select 'b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002',id,30,'CAD',current_date,current_date + 7,'personal','a0000000-0000-0000-0000-000000000002' from public.categories where name='Temporary Personal'$$,'DB-009 owners create Personal budgets');
select lives_ok($$update public.budgets set amount=35 where amount=30 and scope='personal'$$,'DB-009 owners update Personal budgets');
select lives_ok($$delete from public.merchant_rules where merchant_match='temporary private merchant'$$,'DB-009 owners delete Personal merchant rules');
select lives_ok($$delete from public.budgets where amount=35 and scope='personal'$$,'DB-009 owners delete Personal budgets');
select lives_ok($$delete from public.manual_entries where description='Temporary private manual'$$,'DB-009 owners delete Personal manual entries');
select throws_ok($$delete from public.categories where name='Temporary Personal'$$,'42501',null,'DB-009 Personal categories also deny destructive deletion');
select lives_ok($$update public.transaction_metadata set note='Private updated',updated_by='a0000000-0000-0000-0000-000000000002' where transaction_id='f0000000-0000-0000-0000-000000000002'$$,'DB-009 owners update Personal transaction metadata');
select lives_ok($$delete from public.transaction_metadata where transaction_id='f0000000-0000-0000-0000-000000000002'$$,'DB-009 owners delete Personal transaction metadata');
select throws_ok($$insert into public.transaction_metadata(transaction_id,workspace_id,updated_by,scope,note) values ('f0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','family','Improperly shared')$$,'23514',null,'DB-009 Family metadata cannot be created for a Personal transaction');
select lives_ok($$insert into public.transaction_metadata(transaction_id,workspace_id,updated_by,scope,owner_profile_id,note) values ('f0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','personal','a0000000-0000-0000-0000-000000000002','Private restored')$$,'DB-009 owners create Personal transaction metadata');
select results_eq($$select count(*)::bigint from public.categories where id='c0000000-0000-0000-0000-000000000002'$$,array[1::bigint],'DB-009 owner reads their Personal category');
select results_eq($$select count(*)::bigint from public.manual_entries where id='f2000000-0000-0000-0000-000000000002'$$,array[1::bigint],'DB-009 owner reads their Personal manual entry');
select results_eq($$select count(*)::bigint from public.merchant_rules where id='f3000000-0000-0000-0000-000000000002'$$,array[1::bigint],'DB-009 owner reads their Personal merchant rule');
select results_eq($$select count(*)::bigint from public.budgets where id='f4000000-0000-0000-0000-000000000002'$$,array[1::bigint],'DB-009 owner reads their Personal budget');
select results_eq($$select count(*)::bigint from public.transaction_metadata where transaction_id='f0000000-0000-0000-0000-000000000002'$$,array[1::bigint],'DB-009 owner reads their Personal transaction metadata');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select results_eq($$update public.categories set color='#000000' where id='c0000000-0000-0000-0000-000000000002' returning id$$,array[]::uuid[],'DB-009 non-owners cannot update Personal records');
select throws_ok($$delete from public.categories where id='c0000000-0000-0000-0000-000000000002'$$,'42501',null,'DB-009 category deletion is not exposed to authenticated clients');
select results_eq($$select count(*)::bigint from public.manual_entries where id='f2000000-0000-0000-0000-000000000002'$$,array[0::bigint],'DB-009 family owner cannot read another member Personal manual entry');
select results_eq($$select count(*)::bigint from public.merchant_rules where id='f3000000-0000-0000-0000-000000000002'$$,array[0::bigint],'DB-009 family owner cannot read another member Personal merchant rule');
select results_eq($$select count(*)::bigint from public.budgets where id='f4000000-0000-0000-0000-000000000002'$$,array[0::bigint],'DB-009 family owner cannot read another member Personal budget');
select results_eq($$select count(*)::bigint from public.transaction_metadata where transaction_id='f0000000-0000-0000-0000-000000000002'$$,array[0::bigint],'DB-009 family owner cannot read another member Personal transaction metadata');
select results_eq($$update public.manual_entries set amount=999 where id='f2000000-0000-0000-0000-000000000002' returning id$$,array[]::uuid[],'DB-009 family owner cannot update another member Personal manual entry');
select results_eq($$delete from public.manual_entries where id='f2000000-0000-0000-0000-000000000002' returning id$$,array[]::uuid[],'DB-009 family owner cannot delete another member Personal manual entry');
select throws_ok($$update public.merchant_rules set priority=999 where id='f3000000-0000-0000-0000-000000000002'$$,'42501',null,'DB-009 merchant-rule updates require the scoped RPC');
select results_eq($$delete from public.merchant_rules where id='f3000000-0000-0000-0000-000000000002' returning id$$,array[]::uuid[],'DB-009 family owner cannot delete another member Personal merchant rule');
select results_eq($$update public.budgets set amount=999 where id='f4000000-0000-0000-0000-000000000002' returning id$$,array[]::uuid[],'DB-009 family owner cannot update another member Personal budget');
select results_eq($$delete from public.budgets where id='f4000000-0000-0000-0000-000000000002' returning id$$,array[]::uuid[],'DB-009 family owner cannot delete another member Personal budget');
select results_eq($$update public.transaction_metadata set note='Owner takeover',updated_by='a0000000-0000-0000-0000-000000000001' where transaction_id='f0000000-0000-0000-0000-000000000002' returning transaction_id$$,array[]::uuid[],'DB-009 family owner cannot update another member Personal transaction metadata');
select results_eq($$delete from public.transaction_metadata where transaction_id='f0000000-0000-0000-0000-000000000002' returning transaction_id$$,array[]::uuid[],'DB-009 family owner cannot delete another member Personal transaction metadata');

-- DB-010: audit/sync writes denied; audit reads follow scope.
select ok(not has_table_privilege('authenticated','public.audit_events','INSERT') and not has_table_privilege('authenticated','public.audit_events','UPDATE') and not has_table_privilege('authenticated','public.audit_events','DELETE'),'DB-010 authenticated cannot write append-only audit events');
select results_eq($$select count(*)::bigint from public.audit_events where id='f1000000-0000-0000-0000-000000000001'$$,array[1::bigint],'DB-010 active member reads Family audit events');
select results_eq($$select count(*)::bigint from public.audit_events where id='f1000000-0000-0000-0000-000000000002'$$,array[0::bigint],'DB-010 workspace owner cannot read another member Personal audit event');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select results_eq($$select count(*)::bigint from public.audit_events where id='f1000000-0000-0000-0000-000000000002'$$,array[1::bigint],'DB-010 Personal audit owner can read their event');

-- DB-012: every authorization helper behaves as a narrow predicate.
select is(private.is_active_member('b0000000-0000-0000-0000-000000000001'),true,'DB-012 is_active_member recognizes an active member');
select is(private.is_active_owner('b0000000-0000-0000-0000-000000000001'),false,'DB-012 is_active_owner does not elevate a regular member');
select is(private.can_access_scoped_record('b0000000-0000-0000-0000-000000000001','family',null),true,'DB-012 can_access_scoped_record admits Family data for active members');
select is(private.can_access_scoped_record('b0000000-0000-0000-0000-000000000001','personal','a0000000-0000-0000-0000-000000000002'),true,'DB-012 can_access_scoped_record admits owner Personal data');
select is(private.can_access_scoped_record('b0000000-0000-0000-0000-000000000001','personal','a0000000-0000-0000-0000-000000000001'),false,'DB-012 can_access_scoped_record denies another member Personal data');
select is(private.shares_active_workspace('a0000000-0000-0000-0000-000000000001'),true,'DB-012 shares_active_workspace recognizes active peers');
select is(private.can_access_account('e0000000-0000-0000-0000-000000000001'),true,'DB-012 can_access_account follows Family account scope');
select is(private.can_access_transaction('f0000000-0000-0000-0000-000000000001'),true,'DB-012 can_access_transaction follows the account scope');
select is(private.can_view_sync_state('d0000000-0000-0000-0000-000000000001'),true,'DB-012 can_view_sync_state admits only the active linker');

-- DB-011: anonymous, missing-UID, and inactive sessions expose nothing.
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select throws_ok($$select * from public.categories$$,'42501',null,'DB-011 anonymous callers have no protected table access');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select results_eq($$select (select count(*) from public.categories) + (select count(*) from public.audit_events) + (select count(*) from public.workspace_memberships)$$,array[0::bigint],'DB-011 expired/no-UID session sees nothing across scoped and membership policy paths');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select results_eq($$select (select count(*) from public.categories) + (select count(*) from public.audit_events) + (select count(*) from public.workspace_memberships)$$,array[0::bigint],'DB-011 inactive member sees nothing across scoped and membership policy paths');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
select results_eq($$select (select count(*) from public.categories) + (select count(*) from public.audit_events) + (select count(*) from public.workspace_memberships)$$,array[0::bigint],'DB-011 invited member sees nothing across scoped and membership policy paths');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
select results_eq($$select (select count(*) from public.categories) + (select count(*) from public.audit_events) + (select count(*) from public.workspace_memberships)$$,array[0::bigint],'DB-011 outsider sees nothing across scoped and membership policy paths');

reset role;
select * from finish();
rollback;
