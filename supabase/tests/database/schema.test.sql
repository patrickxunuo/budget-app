begin;
set local search_path = public, extensions;
select no_plan();

-- DB-001: the clean migration creates the complete database surface.
select has_schema('private', 'DB-001 creates the private authorization schema');
select has_table('public', 'profiles', 'DB-001 creates profiles');
select has_table('public', 'workspaces', 'DB-001 creates workspaces');
select has_table('public', 'workspace_memberships', 'DB-001 creates workspace_memberships');
select has_table('public', 'invitations', 'DB-001 creates invitations');
select has_table('public', 'plaid_items', 'DB-001 creates plaid_items');
select has_table('public', 'accounts', 'DB-001 creates accounts');
select has_table('public', 'transactions', 'DB-001 creates transactions');
select has_table('public', 'transaction_metadata', 'DB-001 creates transaction_metadata');
select has_table('public', 'manual_entries', 'DB-001 creates manual_entries');
select has_table('public', 'categories', 'DB-001 creates categories');
select has_table('public', 'merchant_rules', 'DB-001 creates merchant_rules');
select has_table('public', 'budgets', 'DB-001 creates budgets');
select has_table('public', 'sync_state', 'DB-001 creates sync_state');
select has_table('public', 'audit_events', 'DB-001 creates audit_events');
select ok(not exists (
  select 1 from (values ('profiles'),('workspaces'),('workspace_memberships'),('invitations'),('plaid_items'),('accounts'),('transactions'),('transaction_metadata'),('manual_entries'),('categories'),('merchant_rules'),('budgets'),('sync_state'),('audit_events')) v(tab)
  where not exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=v.tab and c.column_name='created_at' and c.data_type='timestamp with time zone')
), 'DB-001 all application tables have timestamptz created_at');
select ok((select count(*) > 0 from pg_policies where schemaname='public'), 'DB-001 creates RLS policies');
select ok((select count(*) >= 20 from pg_indexes where schemaname='public'), 'DB-001 creates supporting indexes');

-- DB-003: named checks cover all invalid v1 values.
select ok(exists(select 1 from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace where n.nspname='public' and r.relname='accounts' and c.contype='c' and c.conname<>'' and pg_get_constraintdef(c.oid) ilike '%currency%CAD%'), 'DB-003 accounts has a named CAD check');
select ok(exists(select 1 from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace where n.nspname='public' and r.relname='accounts' and c.contype='c' and c.conname<>'' and pg_get_constraintdef(c.oid) ilike '%chequing%' and pg_get_constraintdef(c.oid) ilike '%savings%' and pg_get_constraintdef(c.oid) ilike '%credit_card%'), 'DB-003 accounts has a named supported account-type check');
select ok(exists(select 1 from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace where n.nspname='public' and r.relname='accounts' and c.contype='c' and c.conname<>'' and pg_get_constraintdef(c.oid) ilike '%scope%' and pg_get_constraintdef(c.oid) ilike '%owner_profile_id%'), 'DB-003 accounts has a named scope/owner check');
select ok(exists(select 1 from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace where n.nspname='public' and r.relname='budgets' and c.contype='c' and c.conname<>'' and pg_get_constraintdef(c.oid) ilike '%amount%0%'), 'DB-003 budgets has a named positive amount check');
select ok(exists(select 1 from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace where n.nspname='public' and r.relname='budgets' and c.contype='c' and c.conname<>'' and pg_get_constraintdef(c.oid) ilike '%end_date%start_date%'), 'DB-003 budgets has a named date-range check');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','schema-owner@example.test','',now(),'{}','{}',now(),now());
insert into public.profiles(id,display_name) values ('10000000-0000-0000-0000-000000000001','Schema Owner');
insert into public.workspaces(id,singleton_key,name,owner_profile_id) values ('20000000-0000-0000-0000-000000000001',true,'Schema Household','10000000-0000-0000-0000-000000000001');
insert into public.workspace_memberships(workspace_id,profile_id,role,status) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','owner','active');
set constraints all immediate;
set constraints all deferred;
insert into public.plaid_items(id,workspace_id,linked_by,plaid_item_id,institution_id,institution_name,access_token_ciphertext,access_token_key_version,status)
values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','schema-item','ins_schema','Schema Bank',decode('0102','hex'),1,'active');

select throws_ok($$insert into public.accounts(workspace_id,plaid_item_id,linked_by,provider_account_id,type,subtype,currency_code,name,scope,owner_profile_id) values ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','bad-usd','depository','chequing','USD','Bad USD','family',null)$$,'23514',null,'DB-003 rejects non-CAD accounts');
select throws_ok($$insert into public.accounts(workspace_id,plaid_item_id,linked_by,provider_account_id,type,subtype,currency_code,name,scope,owner_profile_id) values ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','bad-type','unsupported-garbage','chequing','CAD','Bad Type','family',null)$$,'23514',null,'DB-003 rejects an unsupported provider type with an otherwise valid subtype');
select throws_ok($$insert into public.accounts(workspace_id,plaid_item_id,linked_by,provider_account_id,type,subtype,currency_code,name,scope,owner_profile_id) values ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','bad-depository-pair','depository','credit_card','CAD','Bad Pair','family',null)$$,'23514',null,'DB-003 rejects a credit-card subtype paired with a depository provider type');
select throws_ok($$insert into public.accounts(workspace_id,plaid_item_id,linked_by,provider_account_id,type,subtype,currency_code,name,scope,owner_profile_id) values ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','bad-credit-pair','credit','savings','CAD','Bad Pair','family',null)$$,'23514',null,'DB-003 rejects a savings subtype paired with a credit provider type');
select throws_ok($$insert into public.accounts(workspace_id,plaid_item_id,linked_by,provider_account_id,type,subtype,currency_code,name,scope,owner_profile_id) values ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','bad-owner','depository','chequing','CAD','Bad Owner','family','10000000-0000-0000-0000-000000000001')$$,'23514',null,'DB-003 rejects inconsistent Family ownership');
select throws_ok($$insert into public.budgets(workspace_id,created_by,amount,currency_code,start_date,end_date,scope,owner_profile_id) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',0,'CAD',current_date,current_date,'family',null)$$,'23514',null,'DB-003 rejects non-positive budgets');
select throws_ok($$insert into public.budgets(workspace_id,created_by,amount,currency_code,start_date,end_date,scope,owner_profile_id) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',100,'CAD',current_date,current_date-1,'family',null)$$,'23514',null,'DB-003 rejects invalid budget date ranges');

-- DB-004: singleton workspace and one active owner are unique.
select throws_ok($$insert into public.workspaces(singleton_key,name,owner_profile_id) values (true,'Second Household','10000000-0000-0000-0000-000000000001')$$,'23505',null,'DB-004 rejects a second workspace');
select ok(exists(select 1 from pg_indexes where schemaname='public' and tablename='workspace_memberships' and indexdef ilike '%unique%' and indexdef ilike '%role%owner%' and indexdef ilike '%status%active%'), 'DB-004 has a partial unique active-owner index');
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','schema-owner2@example.test','',now(),'{}','{}',now(),now());
insert into public.profiles(id,display_name) values ('10000000-0000-0000-0000-000000000002','Second Owner');
select throws_ok($$insert into public.workspace_memberships(workspace_id,profile_id,role,status) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','owner','active')$$,'23514',null,'DB-004 rejects an active owner that does not match the workspace owner');
select throws_ok($$delete from public.workspace_memberships where workspace_id='20000000-0000-0000-0000-000000000001' and profile_id='10000000-0000-0000-0000-000000000001'$$,'23514',null,'DB-004 rejects deleting the last active owner');
select throws_ok($$update public.workspace_memberships set role='member' where workspace_id='20000000-0000-0000-0000-000000000001' and profile_id='10000000-0000-0000-0000-000000000001'$$,'23514',null,'DB-004 rejects demoting the last active owner');
select throws_ok($$update public.workspace_memberships set status='inactive' where workspace_id='20000000-0000-0000-0000-000000000001' and profile_id='10000000-0000-0000-0000-000000000001'$$,'23514',null,'DB-004 rejects inactivating the last active owner');
update public.workspaces set owner_profile_id='10000000-0000-0000-0000-000000000002' where id='20000000-0000-0000-0000-000000000001';
select throws_ok($$select private.assert_workspace_owner('20000000-0000-0000-0000-000000000001')$$,'23514',null,'DB-004 rejects workspace ownership that differs from the active owner membership');
update public.workspaces set owner_profile_id='10000000-0000-0000-0000-000000000001' where id='20000000-0000-0000-0000-000000000001';
select is((select count(*) from pg_trigger where tgname in ('workspaces_owner_consistency','memberships_owner_consistency') and tgdeferrable and tginitdeferred),2::bigint,'DB-004 both ownership tables have initially deferred consistency triggers');

-- DB-012: helpers are private, hardened, and narrowly executable.
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('is_active_member','is_active_owner','can_access_scoped_record')), 'DB-012 authorization helpers are outside public');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.prosecdef and p.proname in ('is_active_member','is_active_owner','can_access_scoped_record','shares_active_workspace','can_access_account','can_access_transaction','can_view_sync_state')), 7::bigint, 'DB-012 all seven authorization helpers are security definer');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('is_active_member','is_active_owner','can_access_scoped_record','shares_active_workspace','can_access_account','can_access_transaction','can_view_sync_state') and coalesce(array_to_string(p.proconfig,','),'') !~ 'search_path=(private, pg_catalog|pg_catalog, private|pg_catalog|private)'), 'DB-012 all authorization helpers pin a fixed search_path');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('is_active_member','is_active_owner','can_access_scoped_record','shares_active_workspace','can_access_account','can_access_transaction','can_view_sync_state') and has_function_privilege('public',p.oid,'EXECUTE')), 'DB-012 PUBLIC cannot execute any authorization helper');
select ok(not has_schema_privilege('anon','private','USAGE'), 'DB-012 anon cannot use the private schema');
select ok(not exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename='transaction_metadata' and p.cmd in ('SELECT','UPDATE','DELETE') and coalesce(p.qual,'') not ilike '%can_access_transaction%'),'DB-012 transaction metadata read/write policies authorize the underlying transaction');

select * from finish();
rollback;
