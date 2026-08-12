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

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('81000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-gh8@example.test','',now(),'{}','{}',now(),now()),
('81000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','member-gh8@example.test','',now(),'{}','{}',now(),now());
insert into public.profiles(id,display_name) values
('81000000-0000-4000-8000-000000000001','GH8 Owner'),
('81000000-0000-4000-8000-000000000002','GH8 Member');
insert into public.workspaces(id,singleton_key,name,owner_profile_id) values
('82000000-0000-4000-8000-000000000001',true,'GH8 Household','81000000-0000-4000-8000-000000000001');
insert into public.workspace_memberships(workspace_id,profile_id,role,status) values
('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','owner','active'),
('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','member','active');
set constraints all immediate;
set constraints all deferred;
insert into public.categories(id,workspace_id,created_by,name,color,scope,owner_profile_id) values
('83000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','Family groceries','#18745b','family',null),
('83000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','Owner cash','#477b74','personal','81000000-0000-4000-8000-000000000001'),
('83000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','Member cash','#b56b45','personal','81000000-0000-4000-8000-000000000002');

-- DB-001: PostgreSQL is the final invariant for currency, kind/sign, and privacy-domain categories.
select ok(pg_temp.rejects($statement$
  insert into public.manual_entries(workspace_id,created_by,last_edited_by,scope,kind,amount,currency_code,entry_date,description,category_id)
  values('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','family','income',10,'USD','2026-08-12','Wrong currency','83000000-0000-4000-8000-000000000001')
$statement$),'DB-001 rejects non-CAD currency');
select ok(pg_temp.rejects($statement$
  insert into public.manual_entries(workspace_id,created_by,last_edited_by,scope,kind,amount,entry_date,description,category_id)
  values('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','family','income',0,'2026-08-12','Zero income','83000000-0000-4000-8000-000000000001')
$statement$),'DB-001 rejects zero amount');
select ok(pg_temp.rejects($statement$
  insert into public.manual_entries(workspace_id,created_by,last_edited_by,scope,kind,amount,entry_date,description,category_id)
  values('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','family','spending',10,'2026-08-12','Wrong spending sign','83000000-0000-4000-8000-000000000001')
$statement$),'DB-001 rejects wrong sign for spending');
select ok(pg_temp.rejects($statement$
  insert into public.manual_entries(workspace_id,created_by,last_edited_by,scope,kind,amount,entry_date,description,category_id)
  values('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','family','gift',10,'2026-08-12','Unknown kind','83000000-0000-4000-8000-000000000001')
$statement$),'DB-001 rejects an invalid kind');
select ok(pg_temp.rejects($statement$
  insert into public.manual_entries(workspace_id,created_by,last_edited_by,scope,kind,amount,entry_date,description,category_id)
  values('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','family','spending',-10,'2026-08-12','Cross-domain category','83000000-0000-4000-8000-000000000002')
$statement$),'DB-001 rejects a category outside the entry privacy domain');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
create temp table gh8_created as
select (public.create_manual_entry('personal','income',1250.00,'2026-08-12',' Cash tutoring ','83000000-0000-4000-8000-000000000002',' August sessions ')).*;
select ok((select scope='personal' and owner_profile_id='81000000-0000-4000-8000-000000000001' and created_by='81000000-0000-4000-8000-000000000001' and last_edited_by='81000000-0000-4000-8000-000000000001' and description='Cash tutoring' and notes='August sessions' from gh8_created),'DB-002 Personal create sets owner, author and editor to actor');
select is((select count(*) from public.manual_entries e join gh8_created c on c.id=e.id),1::bigint,'DB-002 Personal owner reads their entry');
select ok((select (public.update_manual_entry(id,'income',1300.00,'2026-08-12','Cash tutoring revised','83000000-0000-4000-8000-000000000002','Revised')).last_edited_by='81000000-0000-4000-8000-000000000001' from gh8_created),'DB-002 Personal owner updates their entry');
select ok((select (public.soft_delete_manual_entry(id,false)).deleted_by='81000000-0000-4000-8000-000000000001' from gh8_created),'DB-002 Personal owner soft-deletes their entry');

select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.manual_entries e join gh8_created c on c.id=e.id),0::bigint,'DB-002 another member sees no Personal row');
select ok((select public.update_manual_entry(c.id,'income',999.00,'2026-08-12','Stolen','83000000-0000-4000-8000-000000000003',null) is null from gh8_created c),'DB-002 another member cannot update Personal data');
select ok((select public.soft_delete_manual_entry(c.id,true) is null from gh8_created c),'DB-002 another member cannot delete Personal data');

-- DB-003: all active members collaborate on Family rows while authorship is durable.
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
create temp table gh8_family as
select (public.create_manual_entry('family','spending',-42.75,'2026-08-12','Neighbourhood market','83000000-0000-4000-8000-000000000001','Bread and fruit')).*;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.manual_entries e join gh8_family f on f.id=e.id),1::bigint,'DB-003 active member reads Family entry');
select ok((select r.created_by='81000000-0000-4000-8000-000000000001' and r.last_edited_by='81000000-0000-4000-8000-000000000002' and r.updated_at>=f.updated_at from gh8_family f cross join lateral public.update_manual_entry(f.id,'refund',12.50,'2026-08-12','Market refund','83000000-0000-4000-8000-000000000001','Corrected') r),'DB-003 collaborator edit retains original author and records last editor');
select ok((select r.deleted_at is not null and r.deleted_by='81000000-0000-4000-8000-000000000002' and r.created_by='81000000-0000-4000-8000-000000000001' from gh8_family f cross join lateral public.soft_delete_manual_entry(f.id,true) r),'DB-003 collaborator soft-delete retains authorship and records deletion actor/time');
select is((select count(*) from public.audit_events where target_id=(select id from gh8_family) and actor_profile_id='81000000-0000-4000-8000-000000000002' and action in ('manual_entry.update','manual_entry.delete')),2::bigint,'DB-003 Family edit and deletion append member audit identities');

-- DB-004: direct hard deletion and identity/scope rewrites cannot bypass history.
reset role;
insert into public.manual_entries(id,workspace_id,created_by,last_edited_by,scope,kind,amount,currency_code,entry_date,description,category_id)
values('84000000-0000-4000-8000-000000000004','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','family','income',100,'CAD','2026-08-12','Immutable identity','83000000-0000-4000-8000-000000000001');
select ok(pg_temp.rejects($$delete from public.manual_entries where id='84000000-0000-4000-8000-000000000004'$$),'DB-004 hard deletion is rejected even for privileged direct SQL');
select ok(pg_temp.rejects($$update public.manual_entries set scope='personal',owner_profile_id='81000000-0000-4000-8000-000000000001' where id='84000000-0000-4000-8000-000000000004'$$),'DB-004 scope and owner rewrite is rejected');
select ok(pg_temp.rejects($$update public.manual_entries set created_by='81000000-0000-4000-8000-000000000002' where id='84000000-0000-4000-8000-000000000004'$$),'DB-004 author identity rewrite is rejected');
select is((select count(*) from public.manual_entries where id='84000000-0000-4000-8000-000000000004' and scope='family' and owner_profile_id is null and created_by='81000000-0000-4000-8000-000000000001'),1::bigint,'DB-004 rejected bypasses leave the auditable row intact');

select * from finish();
rollback;
