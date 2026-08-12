begin;
set local search_path = public, extensions;
select no_plan();

create function pg_temp.rejects(statement text)
returns boolean language plpgsql as $$
begin
  execute statement;
  execute 'set constraints all immediate';
  return false;
exception when others then return true;
end$$;

-- Shared household fixtures. Workspace insertion also exercises the versioned
-- SQL seed trigger; no provider/network fixture participates in the catalog.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('71000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-gh7@example.test','',now(),'{}','{}',now(),now()),
('71000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','member-gh7@example.test','',now(),'{}','{}',now(),now());
insert into public.profiles(id,display_name) values
('71000000-0000-4000-8000-000000000001','GH7 Owner'),
('71000000-0000-4000-8000-000000000002','GH7 Member');
insert into public.workspaces(id,singleton_key,name,owner_profile_id) values
('72000000-0000-4000-8000-000000000001',true,'GH7 Household','71000000-0000-4000-8000-000000000001');
insert into public.workspace_memberships(workspace_id,profile_id,role,status) values
('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','owner','active'),
('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','member','active');
set constraints all immediate;
set constraints all deferred;

insert into public.plaid_items(id,workspace_id,linked_by,plaid_item_id,institution_id,institution_name,access_token_ciphertext,access_token_key_version,status) values
('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','gh7-owner-item','ins-gh7','GH7 Bank',decode('0102','hex'),1,'active'),
('73000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','gh7-member-item','ins-gh7','GH7 Bank',decode('0304','hex'),1,'active');
insert into public.accounts(id,workspace_id,plaid_item_id,linked_by,provider_account_id,type,subtype,currency_code,name,scope,owner_profile_id) values
('74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','gh7-family-account','depository','chequing','CAD','Family Chequing','family',null),
('74000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','gh7-owner-personal','depository','chequing','CAD','Owner Personal','personal','71000000-0000-4000-8000-000000000001'),
('74000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000002','gh7-member-personal','depository','chequing','CAD','Member Personal','personal','71000000-0000-4000-8000-000000000002');
insert into public.transactions(id,workspace_id,account_id,plaid_transaction_id,amount,currency_code,transaction_date,merchant_name,name,pending,provider_payload,removed_at) values
('75000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','gh7-family-match',42.75,'CAD','2026-08-10','Green Market','GREEN MARKET',false,'{"stableMerchantId":"entity-green","personalFinanceCategory":{"primary":"FOOD_AND_DRINK","detailed":"FOOD_AND_DRINK_GROCERIES"}}',null),
('75000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','gh7-family-manual',15.00,'CAD','2026-08-11','Green Market','GREEN MARKET',false,'{"stableMerchantId":"entity-green","personalFinanceCategory":{"primary":"FOOD_AND_DRINK","detailed":"FOOD_AND_DRINK_GROCERIES"}}',null),
('75000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','gh7-family-removed',9.00,'CAD','2026-08-09','Green Market','GREEN MARKET',false,'{"stableMerchantId":"entity-green"}',now()),
('75000000-0000-4000-8000-000000000004','72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000002','gh7-owner-private',8.00,'CAD','2026-08-08','Green Market','GREEN MARKET',false,'{"stableMerchantId":"entity-green"}',null),
('75000000-0000-4000-8000-000000000005','72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000003','gh7-member-private',7.00,'CAD','2026-08-08','Green Market','GREEN MARKET',false,'{"stableMerchantId":"entity-green"}',null),
('75000000-0000-4000-8000-000000000007','72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','gh7-opaque-merchant',5.00,'CAD','2026-08-07','Mixed Identity','MIXED IDENTITY',false,'{"stableMerchantId":" Entity-MiXeD "}',null);
insert into public.categories(id,workspace_id,created_by,name,color,scope,owner_profile_id) values
('76000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','Family custom','#18745b','family',null),
('76000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','Owner private','#b56b45','personal','71000000-0000-4000-8000-000000000001'),
('76000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','Member private','#477b74','personal','71000000-0000-4000-8000-000000000002');
insert into public.transaction_metadata(transaction_id,workspace_id,updated_by,scope,owner_profile_id,category_id,merchant_rule_id) values
('75000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','family',null,'76000000-0000-4000-8000-000000000001',null);

-- DB-001: supported Plaid PFC definitions are stable, local, and versioned.
select is((select count(*) from public.categories where workspace_id='72000000-0000-4000-8000-000000000001' and system_key is not null),19::bigint,'DB-001 migration seeds the supported PFC catalog');
select results_eq($$select system_key from public.categories where workspace_id='72000000-0000-4000-8000-000000000001' and system_key is not null order by system_key$$,$$values ('BANK_FEES'),('ENTERTAINMENT'),('FOOD_AND_DRINK'),('FOOD_AND_DRINK_GROCERIES'),('FOOD_AND_DRINK_RESTAURANT'),('GENERAL_MERCHANDISE'),('GENERAL_SERVICES'),('GOVERNMENT_AND_NON_PROFIT'),('HOME_IMPROVEMENT'),('INCOME'),('LOAN_PAYMENTS'),('MEDICAL'),('PERSONAL_CARE'),('RENT_AND_UTILITIES'),('TRANSFER_IN'),('TRANSFER_OUT'),('TRANSPORTATION'),('TRAVEL'),('UNCATEGORIZED')$$,'DB-001 stable PFC keys are seeded from SQL');
select ok(exists(select 1 from pg_trigger where tgname='workspaces_seed_categories' and not tgisinternal),'DB-001 future workspaces receive the same local catalog');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"71000000-0000-4000-8000-000000000002","role":"authenticated"}',true);

-- DB-002: collaborators see/manage Family data but not each other's Personal rows.
select results_eq($$select name from public.categories where id in ('76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000002','76000000-0000-4000-8000-000000000003') order by name$$,$$values ('Family custom'),('Member private')$$,'DB-002 member sees Family and creator-owned Personal categories only');
select lives_ok($$update public.categories set color='#698b55' where id='76000000-0000-4000-8000-000000000001'$$,'DB-002 every active member manages Family categories');
select results_eq($$update public.categories set name='Owner private stolen' where id='76000000-0000-4000-8000-000000000002' returning id$$,array[]::uuid[],'DB-002 family owner Personal category stays hidden from member');

-- DB-003: category references/rules cannot cross the account privacy domain.
select is(public.set_manual_transaction_category('75000000-0000-4000-8000-000000000005','76000000-0000-4000-8000-000000000003'),true,'DB-003 member may categorize their Personal transaction');
select is(public.set_manual_transaction_category('75000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000003'),false,'DB-003 Family transaction rejects a Personal category');
select is(public.set_manual_transaction_category('75000000-0000-4000-8000-000000000005','76000000-0000-4000-8000-000000000001'),false,'DB-003 Personal transaction rejects a Family category');

-- DB-004: in-use custom categories archive and cannot be deleted; built-ins
-- reject rename/archive. Authenticated clients cannot directly delete even an
-- unused custom category.
update public.categories set archived_at=now() where id='76000000-0000-4000-8000-000000000001';
select ok((select archived_at is not null and in_use from public.category_views where id='76000000-0000-4000-8000-000000000001'),'DB-004 in-use custom category archives and remains queryable');
select ok(pg_temp.rejects($$update public.categories set name='Changed built-in',archived_at=now() where system_key='FOOD_AND_DRINK'$$),'DB-004 built-ins reject rename and archive');
select ok(pg_temp.rejects($$insert into public.categories(workspace_id,created_by,name,color,scope,owner_profile_id) values('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','Groceries','#123456','family',null)$$),'DB-004 custom categories cannot duplicate a seeded active name');
select ok(pg_temp.rejects($$delete from public.categories where id='76000000-0000-4000-8000-000000000001'$$),'DB-004 historical references prevent destructive category deletion');
select ok(pg_temp.rejects($$delete from public.categories where id='76000000-0000-4000-8000-000000000003'$$),'DB-004 direct deletion is denied even for an unused custom category');

-- Restore an active Family target for matcher tests.
update public.categories set archived_at=null where id='76000000-0000-4000-8000-000000000001';

-- DB-005: preview/apply share the exact matcher, exclude removed/manual rows,
-- and append a shared audit event with actor/time.
select is(public.preview_merchant_rule('75000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001','family','merchant_id','entity-green'),1::bigint,'DB-005 preview counts only active non-manual matches in the same privacy scope');
select is(public.preview_merchant_rule('75000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001','family','normalized_name','green market'),1::bigint,'DB-005 SQL fallback normalization matches the JS trim and case contract');
select ok(pg_temp.rejects($$insert into public.merchant_rules(workspace_id,created_by,merchant_match,match_type,category_id,scope,owner_profile_id,enabled) values('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','bypass','merchant_id','76000000-0000-4000-8000-000000000001','family',null,false)$$),'DB-005 direct rule insertion is denied in favor of the validating RPC');
select is(public.create_merchant_rule('75000000-0000-4000-8000-000000000007','76000000-0000-4000-8000-000000000001','family','merchant_id',' Entity-MiXeD ',false)->'rule'->>'match_value',' Entity-MiXeD ','DB-005 opaque merchant IDs preserve whitespace and provider casing');
select is(public.create_merchant_rule('75000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001','family','merchant_id','caller-spoofed',false),null::jsonb,'DB-005 create rejects caller-supplied matcher mismatch');
select is(public.create_merchant_rule('75000000-0000-4000-8000-000000000003','76000000-0000-4000-8000-000000000001','family','merchant_id','entity-green',false),null::jsonb,'DB-005 create rejects removed source transactions');
update public.categories set archived_at=now() where id='76000000-0000-4000-8000-000000000001';
select is(public.create_merchant_rule('75000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001','family','merchant_id','entity-green',false),null::jsonb,'DB-005 create rejects archived target categories');
update public.categories set archived_at=null where id='76000000-0000-4000-8000-000000000001';
create temp table gh7_rule_result as select public.create_merchant_rule('75000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001','family','merchant_id','entity-green',true) result;
select is((select (result->>'updatedCount')::int from gh7_rule_result),1,'DB-005 apply count equals preview count');
select results_eq($$select transaction_id from public.transaction_metadata where merchant_rule_id=(select (result->'rule'->>'id')::uuid from gh7_rule_result) order by transaction_id$$,$$values ('75000000-0000-4000-8000-000000000001'::uuid)$$,'DB-005 rule applies only to preview-eligible rows');
select is((select count(*) from public.audit_events where action='merchant_rules.insert' and actor_profile_id='71000000-0000-4000-8000-000000000002' and target_id=(select (result->'rule'->>'id')::uuid from gh7_rule_result) and created_at is not null),1::bigint,'DB-005 shared rule creation records actor and timestamp');
select is((select count(*) from public.audit_events where action='merchant_rule.apply' and actor_profile_id='71000000-0000-4000-8000-000000000002' and details->>'affectedCount'='1'),1::bigint,'DB-005 shared rule application records actor, rule, category, and affected count');
select ok(pg_temp.rejects($$update public.merchant_rules set scope='personal',owner_profile_id='71000000-0000-4000-8000-000000000002' where id=(select (result->'rule'->>'id')::uuid from gh7_rule_result)$$),'DB-005 direct rule updates are denied');
select ok(pg_temp.rejects($$update public.merchant_rules set merchant_match='rewritten',match_type='normalized_name' where id=(select (result->'rule'->>'id')::uuid from gh7_rule_result)$$),'DB-005 direct matcher rewrites cannot bypass source-derived identity');
select throws_ok(format('select public.update_merchant_rule(%L,%L,null,null)',(select (result->'rule'->>'id')::uuid from gh7_rule_result),(select id from public.categories where system_key='FOOD_AND_DRINK_GROCERIES' and workspace_id='72000000-0000-4000-8000-000000000001')),'23514','used rule category is immutable','DB-005 used-rule category changes are rejected instead of stranding attribution');
select ok((select r.category_id=m.category_id from public.merchant_rules r join public.transaction_metadata m on m.merchant_rule_id=r.id where r.id=(select (result->'rule'->>'id')::uuid from gh7_rule_result)),'DB-005 rejected rule update preserves attribution consistency');

-- DB-006: future sync/import writes trigger the rule while manual metadata wins.
reset role;
insert into public.transactions(id,workspace_id,account_id,plaid_transaction_id,amount,currency_code,transaction_date,merchant_name,name,pending,provider_payload) values
('75000000-0000-4000-8000-000000000006','72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','gh7-future-match',12.00,'CAD','2026-08-12','Green Market','GREEN MARKET',false,'{"stableMerchantId":"entity-green","personalFinanceCategory":{"primary":"FOOD_AND_DRINK","detailed":"FOOD_AND_DRINK_GROCERIES"}}');
select ok((select merchant_rule_id is not null and category_id='76000000-0000-4000-8000-000000000001' from public.transaction_metadata where transaction_id='75000000-0000-4000-8000-000000000006'),'DB-006 future sync commits apply matching rules');
update public.transactions set provider_payload='{"stableMerchantId":"entity-green","personalFinanceCategory":{"primary":"GENERAL_MERCHANDISE","detailed":"GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE"}}' where id='75000000-0000-4000-8000-000000000002';
select ok((select category_id='76000000-0000-4000-8000-000000000001' and merchant_rule_id is null from public.transaction_metadata where transaction_id='75000000-0000-4000-8000-000000000002'),'DB-006 later provider sync never replaces a manual override');
select is((select provider_payload->'personalFinanceCategory'->>'primary' from public.transactions where id='75000000-0000-4000-8000-000000000002'),'GENERAL_MERCHANDISE','DB-006 original provider PFC remains independently mutable and visible');

select * from finish();
rollback;
