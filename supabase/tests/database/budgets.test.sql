begin;
set local search_path = public, extensions;
select no_plan();

create function pg_temp.rejects(statement text)
returns boolean language plpgsql as $$
begin
  execute statement;
  execute 'set constraints all immediate';
  return false;
exception when others then
  return true;
end
$$;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('ba100000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-gh10@example.test','',now(),'{}','{}',now(),now()),
('ba100000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','member-gh10@example.test','',now(),'{}','{}',now(),now());
insert into public.profiles(id,display_name) values
('ba100000-0000-4000-8000-000000000001','GH10 Owner'),
('ba100000-0000-4000-8000-000000000002','GH10 Member');
insert into public.workspaces(id,singleton_key,name,owner_profile_id) values
('ba200000-0000-4000-8000-000000000001',true,'GH10 Household','ba100000-0000-4000-8000-000000000001');
insert into public.workspace_memberships(workspace_id,profile_id,role,status) values
('ba200000-0000-4000-8000-000000000001','ba100000-0000-4000-8000-000000000001','owner','active'),
('ba200000-0000-4000-8000-000000000001','ba100000-0000-4000-8000-000000000002','member','active');
set constraints all immediate;
set constraints all deferred;

insert into public.categories(id,workspace_id,created_by,name,color,scope,owner_profile_id) values
('ba300000-0000-4000-8000-000000000001','ba200000-0000-4000-8000-000000000001','ba100000-0000-4000-8000-000000000001','Family groceries','#18745b','family',null),
('ba300000-0000-4000-8000-000000000002','ba200000-0000-4000-8000-000000000001','ba100000-0000-4000-8000-000000000001','Owner private','#b56b45','personal','ba100000-0000-4000-8000-000000000001'),
('ba300000-0000-4000-8000-000000000003','ba200000-0000-4000-8000-000000000001','ba100000-0000-4000-8000-000000000002','Member private','#477b74','personal','ba100000-0000-4000-8000-000000000002');

-- DB-001: active members collaborate on Family targets while Personal targets
-- remain readable and writable only by their owner, including against the
-- household owner.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"ba100000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
create temp table member_family_result as
select public.create_budget_target(
  'family',
  'ba300000-0000-4000-8000-000000000001',
  50000,
  '2026-08-01'
) result;
create temp table member_personal_result as
select public.create_budget_target(
  'personal',
  'ba300000-0000-4000-8000-000000000003',
  25000,
  '2026-08-01'
) result;
select ok(
  (select count(*) = 1 from public.budgets
   where category_id='ba300000-0000-4000-8000-000000000001'
     and scope='family' and owner_profile_id is null),
  'DB-001 an active member creates and reads a collaborative Family target'
);
select ok(
  (select count(*) = 1 from public.budgets
   where category_id='ba300000-0000-4000-8000-000000000003'
     and scope='personal' and owner_profile_id='ba100000-0000-4000-8000-000000000002'),
  'DB-001 a member creates and reads their owner-bound Personal target'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"ba100000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select ok(
  (select count(*) = 0 from public.budgets
   where category_id='ba300000-0000-4000-8000-000000000003'),
  'DB-001 even the family owner cannot see another member Personal target'
);
select lives_ok(
  $$select public.revise_budget_target(
    (select id from public.budgets where category_id='ba300000-0000-4000-8000-000000000001'),
    60000,
    '2026-09-01'
  )$$,
  'DB-001 any active member may revise a Family target'
);

-- DB-002: every create/revision remains in the category workspace/privacy
-- domain; cross-scope and foreign-owner category assignment fail closed.
select ok(
  pg_temp.rejects($$select public.create_budget_target(
    'family',
    'ba300000-0000-4000-8000-000000000002',
    10000,
    '2026-08-01'
  )$$),
  'DB-002 a Family target rejects a Personal category'
);
select ok(
  pg_temp.rejects($$select public.create_budget_target(
    'personal',
    'ba300000-0000-4000-8000-000000000003',
    10000,
    '2026-08-01'
  )$$),
  'DB-002 a Personal target rejects another member category'
);

-- DB-003: revisions append effective-dated history, close the old version at
-- the preceding month, and overlapping applicable targets are rejected.
select is(
  (select amount_cents from public.budgets
   where category_id='ba300000-0000-4000-8000-000000000001'
     and effective_month='2026-08-01'),
  50000::bigint,
  'DB-003 revision never rewrites the historical amount'
);
select is(
  (select end_month from public.budgets
   where category_id='ba300000-0000-4000-8000-000000000001'
     and effective_month='2026-08-01'),
  '2026-08-01'::date,
  'DB-003 revision closes the prior version at the preceding calendar month'
);
select is(
  (select amount_cents from public.budgets
   where category_id='ba300000-0000-4000-8000-000000000001'
     and effective_month='2026-09-01'),
  60000::bigint,
  'DB-003 later months apply the appended revision'
);
select ok(
  pg_temp.rejects($$select public.create_budget_target(
    'family',
    'ba300000-0000-4000-8000-000000000001',
    70000,
    '2026-09-01'
  )$$),
  'DB-003 overlap for category scope owner and month is rejected'
);

-- DB-003 edge cases and stale-caller serialization. This rollback-only pgTAP
-- process owns one PostgreSQL session, so it cannot create a genuinely blocked
-- two-session race. It nevertheless exercises stale IDs after a committed
-- version transition and asserts the advisory-lock serialization boundary.
select ok(
  pg_temp.rejects($$select public.create_budget_target(
    'family',
    'ba300000-0000-4000-8000-000000000001',
    70000,
    null
  )$$),
  'DB-003 null effective month is rejected on create'
);
select ok(
  pg_temp.rejects($$select public.revise_budget_target(
    (select id from public.budgets
     where category_id='ba300000-0000-4000-8000-000000000001'
       and effective_month='2026-09-01'),
    70000,
    null
  )$$),
  'DB-003 null effective month is rejected on revise'
);
select ok(
  pg_temp.rejects($$select public.archive_budget_target(
    (select id from public.budgets
     where category_id='ba300000-0000-4000-8000-000000000001'
       and effective_month='2026-09-01'),
    null
  )$$),
  'DB-003 null effective month is rejected on archive'
);
select ok(
  pg_temp.rejects($$select public.revise_budget_target(
    (select id from public.budgets
     where category_id='ba300000-0000-4000-8000-000000000001'
       and effective_month='2026-08-01'),
    71000,
    '2026-10-01'
  )$$),
  'DB-003 stale caller cannot revise the already-closed prior version'
);
select lives_ok(
  $$select public.archive_budget_target(
    (select id from public.budgets
     where category_id='ba300000-0000-4000-8000-000000000001'
       and effective_month='2026-09-01'),
    '2026-11-01'
  )$$,
  'DB-003 current recurrence archives from an explicit later month'
);
select is(
  (select end_month from public.budgets
   where category_id='ba300000-0000-4000-8000-000000000001'
     and effective_month='2026-09-01'),
  '2026-10-01'::date,
  'DB-003 archive establishes the immutable inclusive cutoff'
);
select ok(
  pg_temp.rejects($$select public.archive_budget_target(
    (select id from public.budgets
     where category_id='ba300000-0000-4000-8000-000000000001'
       and effective_month='2026-09-01'),
    '2026-12-01'
  )$$),
  'DB-003 repeated archive cannot move an established cutoff'
);
select ok(
  pg_temp.rejects($$select public.revise_budget_target(
    (select id from public.budgets
     where category_id='ba300000-0000-4000-8000-000000000001'
       and effective_month='2026-09-01'),
    72000,
    '2026-12-01'
  )$$),
  'DB-003 revise-after-archive cannot resurrect recurrence'
);
select is(
  (select end_month from public.budgets
   where category_id='ba300000-0000-4000-8000-000000000001'
     and effective_month='2026-09-01'),
  '2026-10-01'::date,
  'DB-003 rejected stale/repeated callers leave the cutoff unchanged'
);
select ok(
  (select bool_and(pg_get_functiondef(p.oid) like '%pg_advisory_xact_lock%')
   from pg_proc p
   where p.pronamespace='public'::regnamespace
     and p.proname in ('create_budget_target','revise_budget_target','archive_budget_target')),
  'DB-003 every write RPC serializes the category privacy-domain key'
);
-- DB-004: authenticated clients cannot bypass validation/history through
-- direct DML; SECURITY DEFINER write RPCs pin search_path.
select ok(
  pg_temp.rejects($$insert into public.budgets(
    workspace_id,created_by,category_id,scope,owner_profile_id,
    amount_cents,currency_code,effective_month,end_month
  ) values(
    'ba200000-0000-4000-8000-000000000001',
    'ba100000-0000-4000-8000-000000000001',
    'ba300000-0000-4000-8000-000000000001',
    'family',null,99999,'CAD','2027-01-01',null
  )$$),
  'DB-004 authenticated direct insert is denied'
);
select ok(
  pg_temp.rejects($$update public.budgets set amount_cents=1
    where category_id='ba300000-0000-4000-8000-000000000001'$$),
  'DB-004 authenticated direct update cannot rewrite history'
);
select ok(
  pg_temp.rejects($$delete from public.budgets
    where category_id='ba300000-0000-4000-8000-000000000001'$$),
  'DB-004 authenticated direct delete cannot erase history'
);
select ok(
  (select bool_and(prosecdef and coalesce(proconfig::text,'') like '%search_path%')
   from pg_proc
   where pronamespace='public'::regnamespace
     and proname in ('create_budget_target','revise_budget_target','archive_budget_target')),
  'DB-004 budget write RPCs are SECURITY DEFINER with a fixed search_path'
);

select * from finish();
rollback;

