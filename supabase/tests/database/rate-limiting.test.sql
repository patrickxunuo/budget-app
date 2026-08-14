begin;
set local search_path = public, extensions;
select no_plan();

-- GH-14 F3: the fixed-window counter is a service-only control surface. A
-- readable counter discloses when a household is signing in, and a writable
-- one lets an attacker reset their own window.

-- Privileged fixture: one live counter row so an authenticated read has
-- something to leak if the policy surface were wrong.
insert into public.rate_limit_counters(bucket, subject, window_started_at, attempts)
values ('sign_in', 'seeded-opaque-subject', date_trunc('minute', now()), 1);

-- GH-14 DB-001: RLS is on and no policy admits a browser role.
select ok(
  (select relrowsecurity from pg_class where oid = 'public.rate_limit_counters'::regclass),
  'GH-14 DB-001 rate_limit_counters has row level security enabled'
);
select is(
  (select count(*)::bigint from pg_policies
   where schemaname = 'public' and tablename = 'rate_limit_counters'
     and ('authenticated' = any(roles) or 'anon' = any(roles) or 'public' = any(roles))),
  0::bigint,
  'GH-14 DB-001 no policy grants anon or authenticated any access to the counters'
);
select ok(
  not has_table_privilege('authenticated', 'public.rate_limit_counters', 'SELECT')
  and not has_table_privilege('authenticated', 'public.rate_limit_counters', 'INSERT')
  and not has_table_privilege('authenticated', 'public.rate_limit_counters', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.rate_limit_counters', 'DELETE'),
  'GH-14 DB-001 authenticated holds no table privilege on the counters'
);
select ok(
  not has_table_privilege('anon', 'public.rate_limit_counters', 'SELECT')
  and not has_table_privilege('anon', 'public.rate_limit_counters', 'INSERT')
  and not has_table_privilege('anon', 'public.rate_limit_counters', 'UPDATE')
  and not has_table_privilege('anon', 'public.rate_limit_counters', 'DELETE'),
  'GH-14 DB-001 anon holds no table privilege on the counters'
);
select ok(
  has_table_privilege('service_role', 'public.rate_limit_counters', 'SELECT')
  and has_table_privilege('service_role', 'public.rate_limit_counters', 'INSERT')
  and has_table_privilege('service_role', 'public.rate_limit_counters', 'UPDATE'),
  'GH-14 DB-001 only the trusted server can read or write the counters'
);

-- GH-14 DB-002: a real authenticated session is denied every verb.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$select * from public.rate_limit_counters$$,
  '42501', null,
  'GH-14 DB-002 an authenticated session cannot read the counters'
);
select throws_ok(
  $$insert into public.rate_limit_counters(bucket,subject,window_started_at,attempts) values ('sign_in','forged',now(),0)$$,
  '42501', null,
  'GH-14 DB-002 an authenticated session cannot insert a counter'
);
select throws_ok(
  $$update public.rate_limit_counters set attempts=0$$,
  '42501', null,
  'GH-14 DB-002 an authenticated session cannot reset its own window'
);
select throws_ok(
  $$delete from public.rate_limit_counters$$,
  '42501', null,
  'GH-14 DB-002 an authenticated session cannot delete a counter'
);
select throws_ok(
  $$select * from private.consume_rate_limit('sign_in','forged',5,60)$$,
  '42501', null,
  'GH-14 DB-002 an authenticated session cannot execute the private limiter'
);
select throws_ok(
  $$select * from public.consume_rate_limit('sign_in','forged',5,60)$$,
  '42501', null,
  'GH-14 DB-002 an authenticated session cannot execute the exposed wrapper'
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$select * from public.rate_limit_counters$$,
  '42501', null,
  'GH-14 DB-002 an anonymous caller cannot read the counters'
);
select throws_ok(
  $$select * from public.consume_rate_limit('sign_in','forged',5,60)$$,
  '42501', null,
  'GH-14 DB-002 an anonymous caller cannot consume a rate limit'
);
reset role;

-- GH-14 DB-003: the limiter follows the project's RLS-helper convention.
select ok(
  (select prosecdef from pg_proc where oid = 'private.consume_rate_limit(text,text,int,int)'::regprocedure),
  'GH-14 DB-003 private.consume_rate_limit is a security-definer function'
);
select ok(
  (select coalesce(array_to_string(proconfig, ','), '') ~ 'search_path='
   from pg_proc where oid = 'private.consume_rate_limit(text,text,int,int)'::regprocedure),
  'GH-14 DB-003 private.consume_rate_limit pins its search_path'
);
select ok(
  (select prosecdef and coalesce(array_to_string(proconfig, ','), '') ~ 'search_path='
   from pg_proc where oid = 'public.consume_rate_limit(text,text,int,int)'::regprocedure),
  'GH-14 DB-003 the PostgREST-reachable wrapper is equally hardened'
);
select ok(
  not exists(
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid in (
      'private.consume_rate_limit(text,text,int,int)'::regprocedure,
      'public.consume_rate_limit(text,text,int,int)'::regprocedure
    )
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'GH-14 DB-003 default PUBLIC execution is revoked from both limiter entry points'
);
select ok(
  not has_function_privilege('anon', 'private.consume_rate_limit(text,text,int,int)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.consume_rate_limit(text,text,int,int)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.consume_rate_limit(text,text,int,int)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.consume_rate_limit(text,text,int,int)', 'EXECUTE')
  and has_function_privilege('service_role', 'private.consume_rate_limit(text,text,int,int)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.consume_rate_limit(text,text,int,int)', 'EXECUTE'),
  'GH-14 DB-003 execution is granted to service_role alone'
);

-- GH-14 DB-004: fixed-window counting behaviour, exercised as the trusted server.
set local role service_role;
select results_eq(
  $$select allowed, remaining, retry_after_seconds from private.consume_rate_limit('sign_in','subject-alpha',3,60)$$,
  $$values (true, 2, 0)$$,
  'GH-14 DB-004 the first attempt is allowed and decrements the remaining budget'
);
select results_eq(
  $$select allowed, remaining, retry_after_seconds from private.consume_rate_limit('sign_in','subject-alpha',3,60)$$,
  $$values (true, 1, 0)$$,
  'GH-14 DB-004 the second attempt is allowed'
);
select results_eq(
  $$select allowed, remaining, retry_after_seconds from private.consume_rate_limit('sign_in','subject-alpha',3,60)$$,
  $$values (true, 0, 0)$$,
  'GH-14 DB-004 the attempt that exactly reaches the limit is still allowed'
);
select results_eq(
  $$select allowed, remaining from private.consume_rate_limit('sign_in','subject-alpha',3,60)$$,
  $$values (false, 0)$$,
  'GH-14 DB-005 the attempt past the limit is denied'
);
select ok(
  (select retry_after_seconds > 0 from private.consume_rate_limit('sign_in','subject-alpha',3,60)),
  'GH-14 DB-005 a denied attempt reports a positive retry_after_seconds'
);
select ok(
  (select retry_after_seconds <= 60 from private.consume_rate_limit('sign_in','subject-alpha',3,60)),
  'GH-14 DB-005 the retry delay never exceeds the configured window'
);

-- GH-14 DB-006: windows are keyed by bucket and subject, so neither leaks.
select results_eq(
  $$select allowed, remaining from private.consume_rate_limit('sign_in','subject-beta',3,60)$$,
  $$values (true, 2)$$,
  'GH-14 DB-006 a different subject in the same bucket has an independent window'
);
select results_eq(
  $$select allowed, remaining from private.consume_rate_limit('password_reset','subject-alpha',3,60)$$,
  $$values (true, 2)$$,
  'GH-14 DB-006 a different bucket for the same subject has an independent window'
);
select results_eq(
  $$select allowed, remaining from private.consume_rate_limit('sign_in','subject-alpha',3,60)$$,
  $$values (false, 0)$$,
  'GH-14 DB-006 the exhausted window is unaffected by the independent ones'
);

-- GH-14 DB-007: the window rolls over. Ageing the stored window start is the
-- deterministic equivalent of waiting, and proves the key is time-derived
-- rather than a single durable counter per subject.
update public.rate_limit_counters
set window_started_at = window_started_at - interval '2 minutes'
where bucket = 'sign_in' and subject = 'subject-alpha';
select results_eq(
  $$select allowed, remaining, retry_after_seconds from private.consume_rate_limit('sign_in','subject-alpha',3,60)$$,
  $$values (true, 2, 0)$$,
  'GH-14 DB-007 a new fixed window admits the subject again once the previous one elapsed'
);

-- GH-14 DB-008: the exposed wrapper and the private helper share one counter,
-- so routing through PostgREST cannot double a member's budget.
select results_eq(
  $$select allowed, remaining from public.consume_rate_limit('auth_callback','subject-delta',2,60)$$,
  $$values (true, 1)$$,
  'GH-14 DB-008 the exposed wrapper delegates to the private limiter'
);
select results_eq(
  $$select allowed, remaining from private.consume_rate_limit('auth_callback','subject-delta',2,60)$$,
  $$values (true, 0)$$,
  'GH-14 DB-008 the wrapper and the private helper increment the same counter'
);
select results_eq(
  $$select allowed, remaining from public.consume_rate_limit('auth_callback','subject-delta',2,60)$$,
  $$values (false, 0)$$,
  'GH-14 DB-008 the shared counter denies the attempt past the limit through either entry point'
);

-- GH-14 DB-009: an unusable policy fails closed instead of admitting everything.
select throws_ok(
  $$select * from private.consume_rate_limit('sign_in','subject-gamma',0,60)$$,
  '22023', null,
  'GH-14 DB-009 a non-positive limit is rejected rather than admitting every attempt'
);
select throws_ok(
  $$select * from private.consume_rate_limit('sign_in','subject-gamma',5,0)$$,
  '22023', null,
  'GH-14 DB-009 a non-positive window is rejected'
);
select is(
  (select count(*)::bigint from public.rate_limit_counters where subject = 'subject-gamma'),
  0::bigint,
  'GH-14 DB-009 a rejected policy writes no counter row'
);

-- GH-14 DB-010: a proven identity clears its budget, so only failures
-- accumulate. Without this the limit counts successful sign-ins and a
-- legitimate burst locks itself out.
select lives_ok(
  $$select private.reset_rate_limit('sign_in','subject-reset')$$,
  'GH-14 DB-010 reset_rate_limit runs for the service role'
);
select * from private.consume_rate_limit('sign_in', 'subject-reset', 2, 300);
select * from private.consume_rate_limit('sign_in', 'subject-reset', 2, 300);
select is(
  (select allowed from private.consume_rate_limit('sign_in','subject-reset',2,300)),
  false,
  'GH-14 DB-010 the third attempt in a 2-attempt window is denied'
);
select private.reset_rate_limit('sign_in', 'subject-reset');
select is(
  (select count(*)::bigint from public.rate_limit_counters where subject = 'subject-reset'),
  0::bigint,
  'GH-14 DB-010 the reset removes every counter row for the subject'
);
select is(
  (select allowed from private.consume_rate_limit('sign_in','subject-reset',2,300)),
  true,
  'GH-14 DB-010 the subject is admitted again after a successful authentication'
);

-- GH-14 DB-011: the reset is scoped to one bucket and one subject, so proving
-- an identity on one surface cannot clear an attacker's budget on another.
select private.reset_rate_limit('sign_in', 'subject-scoped-a');
select * from private.consume_rate_limit('sign_in', 'subject-scoped-a', 5, 300);
select * from private.consume_rate_limit('sign_in', 'subject-scoped-b', 5, 300);
select * from private.consume_rate_limit('password_reset', 'subject-scoped-a', 5, 300);
select private.reset_rate_limit('sign_in', 'subject-scoped-a');
select is(
  (select count(*)::bigint from public.rate_limit_counters where subject = 'subject-scoped-b'),
  1::bigint,
  'GH-14 DB-011 another subject in the same bucket keeps its counter'
);
select is(
  (select count(*)::bigint from public.rate_limit_counters
   where subject = 'subject-scoped-a' and bucket = 'password_reset'),
  1::bigint,
  'GH-14 DB-011 the same subject in another bucket keeps its counter'
);

-- GH-14 DB-012: the reset entry points carry the same service-only boundary as
-- the counters themselves.
set local role authenticated;
select throws_ok(
  $$select public.reset_rate_limit('sign_in','subject-reset')$$,
  '42501', null,
  'GH-14 DB-012 an authenticated caller cannot clear a rate-limit budget'
);
select throws_ok(
  $$select private.reset_rate_limit('sign_in','subject-reset')$$,
  '42501', null,
  'GH-14 DB-012 the private reset is unreachable from an authenticated role'
);
reset role;

reset role;
select * from finish();
rollback;
