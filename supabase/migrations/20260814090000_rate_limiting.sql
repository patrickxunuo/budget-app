-- GH-14: fixed-window rate limiting for the unauthenticated surfaces.

-- Service-only attempt counters. The subject is already a sha256 digest of the
-- client IP and optional email, but a readable counter still discloses when a
-- given household is signing in, so RLS is enabled with no policy at all and
-- every privilege is revoked from the API roles.
create table if not exists public.rate_limit_counters (
  id uuid primary key default gen_random_uuid(),
  bucket text not null check (length(trim(bucket)) between 1 and 64),
  subject text not null check (length(trim(subject)) between 1 and 128),
  window_started_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  constraint rate_limit_counters_window_unique unique (bucket, subject, window_started_at)
);
alter table public.rate_limit_counters enable row level security;
revoke all on public.rate_limit_counters from public, anon, authenticated;
grant all on public.rate_limit_counters to service_role;
create index if not exists rate_limit_counters_window_idx on public.rate_limit_counters (window_started_at);
comment on table public.rate_limit_counters is 'Service-only fixed-window attempt counters; RLS enabled with no policy so anon and authenticated can neither read nor write it.';

create or replace function private.consume_rate_limit(
  p_bucket text, p_subject text, p_limit int, p_window_seconds int
) returns table(allowed boolean, remaining int, retry_after_seconds int)
language plpgsql security definer set search_path = '' as $$
declare v_window_start timestamptz; v_window_end timestamptz; v_attempts int;
begin
  if p_limit < 1 or p_window_seconds < 1 then raise exception using errcode='22023',message='invalid rate limit policy'; end if;
  v_window_start := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds)::bigint * p_window_seconds);
  v_window_end := v_window_start + make_interval(secs => p_window_seconds);
  -- One statement, so concurrent attempts serialize on the unique index row
  -- instead of racing a read-then-write and admitting more than the limit.
  insert into public.rate_limit_counters(bucket,subject,window_started_at,attempts)
  values(p_bucket,p_subject,v_window_start,1)
  on conflict(bucket,subject,window_started_at)
    do update set attempts = rate_limit_counters.attempts + 1
  returning attempts into v_attempts;
  allowed := v_attempts <= p_limit;
  remaining := greatest(p_limit - v_attempts, 0);
  if allowed then retry_after_seconds := 0;
  else retry_after_seconds := greatest(ceil(extract(epoch from v_window_end - clock_timestamp()))::int, 1); end if;
  return next;
end $$;

-- PostgREST only reaches `public`, so the service-role caller enters through
-- this wrapper while the counter logic stays in the non-exposed `private`
-- schema with the project's other security-definer helpers.
create or replace function public.consume_rate_limit(
  p_bucket text, p_subject text, p_limit int, p_window_seconds int
) returns table(allowed boolean, remaining int, retry_after_seconds int)
language sql security definer set search_path = '' as $$
  select * from private.consume_rate_limit(p_bucket, p_subject, p_limit, p_window_seconds);
$$;

-- Clearing the budget on a proven identity is what keeps this a brute-force
-- control rather than a usage cap: an attacker's traffic is failures by
-- definition, so only failures should accumulate. Without it the limit counts
-- successful sign-ins too, and a legitimate burst — a member on a shared NAT
-- address, or the browser suite — locks itself out.
create or replace function private.reset_rate_limit(p_bucket text, p_subject text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.rate_limit_counters
  where bucket = p_bucket and subject = p_subject;
end $$;

create or replace function public.reset_rate_limit(p_bucket text, p_subject text)
returns void language sql security definer set search_path = '' as $$
  select private.reset_rate_limit(p_bucket, p_subject);
$$;

revoke all on function private.consume_rate_limit(text,text,int,int) from public, anon, authenticated;
grant execute on function private.consume_rate_limit(text,text,int,int) to service_role;
revoke all on function public.consume_rate_limit(text,text,int,int) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text,text,int,int) to service_role;
revoke all on function private.reset_rate_limit(text,text) from public, anon, authenticated;
grant execute on function private.reset_rate_limit(text,text) to service_role;
revoke all on function public.reset_rate_limit(text,text) from public, anon, authenticated;
grant execute on function public.reset_rate_limit(text,text) to service_role;
