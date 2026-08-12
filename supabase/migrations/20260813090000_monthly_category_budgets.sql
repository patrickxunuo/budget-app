-- GH-10: effective-dated monthly category budgets with RPC-only mutation.
alter table public.budgets
  add column if not exists amount_cents bigint,
  add column if not exists effective_month date,
  add column if not exists end_month date;

update public.budgets
set amount_cents = round(amount * 100)::bigint,
    effective_month = date_trunc('month', start_date)::date,
    end_month = date_trunc('month', end_date)::date
where amount_cents is null or effective_month is null;

-- Legacy rows cannot be guessed into a category or collapsed without changing
-- financial history. Abort deterministically before tightening the schema.
do $$
begin
  if exists (
    select 1 from public.budgets
    where category_id is null or amount_cents is null or effective_month is null
  ) then
    raise exception using
      errcode = '23502',
      message = 'GH-10 migration cannot represent legacy budget rows with a null category or month';
  end if;

  if exists (
    select 1
    from public.budgets a
    join public.budgets b
      on a.id::text < b.id::text
     and a.workspace_id = b.workspace_id
     and a.scope = b.scope
     and a.owner_profile_id is not distinct from b.owner_profile_id
     and a.category_id = b.category_id
     and a.effective_month <= coalesce(b.end_month, 'infinity'::date)
     and b.effective_month <= coalesce(a.end_month, 'infinity'::date)
  ) then
    raise exception using
      errcode = '23P01',
      message = 'GH-10 migration found overlapping legacy budget ranges; resolve them before retrying';
  end if;
end $$;

alter table public.budgets
  alter column category_id set not null,
  alter column amount_cents set not null,
  alter column effective_month set not null;

alter table public.budgets drop constraint if exists budgets_amount_positive;
alter table public.budgets drop constraint if exists budgets_date_range_valid;
alter table public.budgets drop constraint if exists budgets_amount_cents_safe;
alter table public.budgets add constraint budgets_amount_cents_safe check (
  amount_cents between 1 and 9007199254740991
);
alter table public.budgets drop constraint if exists budgets_effective_month_first;
alter table public.budgets add constraint budgets_effective_month_first check (
  effective_month = date_trunc('month', effective_month)::date
  and (end_month is null or end_month = date_trunc('month', end_month)::date)
);
alter table public.budgets drop constraint if exists budgets_month_range_valid;
alter table public.budgets add constraint budgets_month_range_valid check (
  end_month is null or end_month >= effective_month or archived_at is not null
);

alter table public.budgets drop column if exists amount;
alter table public.budgets drop column if exists start_date;
alter table public.budgets drop column if exists end_date;

create index if not exists budgets_effective_lookup_idx
  on public.budgets(workspace_id, scope, owner_profile_id, category_id, effective_month, end_month);

create or replace function private.prevent_budget_overlap()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if exists (
    select 1 from public.budgets b
    where b.id <> new.id
      and b.workspace_id = new.workspace_id
      and b.scope = new.scope
      and b.owner_profile_id is not distinct from new.owner_profile_id
      and b.category_id = new.category_id
      and b.effective_month <= coalesce(new.end_month, 'infinity'::date)
      and new.effective_month <= coalesce(b.end_month, 'infinity'::date)
  ) then
    raise exception using errcode = '23P01', message = 'budget target versions overlap';
  end if;
  return new;
end $$;
revoke all on function private.prevent_budget_overlap() from public, anon, authenticated;
drop trigger if exists budgets_no_overlap on public.budgets;
create constraint trigger budgets_no_overlap after insert or update of effective_month, end_month, category_id, scope, owner_profile_id
  on public.budgets deferrable initially immediate for each row execute function private.prevent_budget_overlap();

-- The authenticated role can read only through RLS. Every mutation crosses the
-- fixed-search-path functions below so family collaboration and personal
-- ownership are checked in the same transaction as versioning.
revoke insert, update, delete on public.budgets from authenticated;

drop policy if exists budgets_insert on public.budgets;
drop policy if exists budgets_update on public.budgets;
drop policy if exists budgets_delete on public.budgets;

create or replace function public.create_budget_target(
  p_scope public.data_scope, p_category_id uuid, p_amount_cents bigint, p_effective_month date
) returns public.budgets
language plpgsql security definer set search_path = pg_catalog as $$
declare v_workspace uuid; v_owner uuid; v_row public.budgets%rowtype;
begin
  select m.workspace_id into v_workspace from public.workspace_memberships m
  where m.profile_id = auth.uid() and m.status = 'active' limit 1;
  if v_workspace is null then raise exception using errcode='42501', message='active membership required'; end if;
  if p_scope is null or p_category_id is null or p_effective_month is null
    or p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 9007199254740991
    or p_effective_month <> date_trunc('month', p_effective_month)::date then
    raise exception using errcode='22023', message='invalid budget target';
  end if;
  v_owner := case when p_scope='personal' then auth.uid() else null end;
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text || ':' || p_scope::text || ':' || coalesce(v_owner::text,'family') || ':' || p_category_id::text, 0));
  if not exists(select 1 from public.categories c where c.id=p_category_id and c.workspace_id=v_workspace and c.scope=p_scope and c.owner_profile_id is not distinct from v_owner and c.archived_at is null) then
    raise exception using errcode='23503', message='category is not available in this privacy scope';
  end if;
  insert into public.budgets(workspace_id,created_by,category_id,amount_cents,currency_code,effective_month,end_month,scope,owner_profile_id)
  values(v_workspace,auth.uid(),p_category_id,p_amount_cents,'CAD',p_effective_month,null,p_scope,v_owner)
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.revise_budget_target(
  p_id uuid, p_amount_cents bigint, p_effective_month date
) returns public.budgets
language plpgsql security definer set search_path = pg_catalog as $$
declare v_identity public.budgets%rowtype; v_current public.budgets%rowtype; v_row public.budgets%rowtype;
begin
  if p_effective_month is null or p_amount_cents is null
    or p_amount_cents < 1 or p_amount_cents > 9007199254740991
    or p_effective_month <> date_trunc('month', p_effective_month)::date then
    raise exception using errcode='22023', message='invalid budget revision';
  end if;

  -- The first read only discovers the stable privacy/category lock key. No
  -- mutable version state is trusted until after the advisory lock is held.
  select * into v_identity from public.budgets b where b.id=p_id
    and private.can_access_scoped_record(b.workspace_id,b.scope,b.owner_profile_id);
  if not found then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_identity.workspace_id::text || ':' || v_identity.scope::text || ':' || coalesce(v_identity.owner_profile_id::text,'family') || ':' || v_identity.category_id::text, 0));

  select * into v_current from public.budgets b where b.id=p_id
    and private.can_access_scoped_record(b.workspace_id,b.scope,b.owner_profile_id)
    for update;
  if not found then return null; end if;
  if v_current.archived_at is not null or v_current.end_month is not null then
    raise exception using errcode='22023', message='only the current recurring budget version can be revised';
  end if;
  if p_effective_month <= v_current.effective_month then
    raise exception using errcode='22023', message='revision month must follow the current version';
  end if;

  update public.budgets set end_month=(p_effective_month - interval '1 month')::date, updated_at=now() where id=v_current.id;
  insert into public.budgets(workspace_id,created_by,category_id,amount_cents,currency_code,effective_month,end_month,scope,owner_profile_id)
  values(v_current.workspace_id,auth.uid(),v_current.category_id,p_amount_cents,'CAD',p_effective_month,null,v_current.scope,v_current.owner_profile_id)
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.archive_budget_target(p_id uuid, p_effective_month date)
returns public.budgets language plpgsql security definer set search_path = pg_catalog as $$
declare v_identity public.budgets%rowtype; v_current public.budgets%rowtype; v_row public.budgets%rowtype;
begin
  if p_effective_month is null or p_effective_month <> date_trunc('month',p_effective_month)::date then
    raise exception using errcode='22023',message='invalid archive month';
  end if;

  select * into v_identity from public.budgets b where b.id=p_id
    and private.can_access_scoped_record(b.workspace_id,b.scope,b.owner_profile_id);
  if not found then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_identity.workspace_id::text || ':' || v_identity.scope::text || ':' || coalesce(v_identity.owner_profile_id::text,'family') || ':' || v_identity.category_id::text, 0));

  select * into v_current from public.budgets b where b.id=p_id
    and private.can_access_scoped_record(b.workspace_id,b.scope,b.owner_profile_id)
    for update;
  if not found then return null; end if;
  if v_current.archived_at is not null or v_current.end_month is not null then
    raise exception using errcode='22023', message='only the current recurring budget version can be archived';
  end if;
  if p_effective_month < v_current.effective_month then
    raise exception using errcode='22023',message='archive month cannot precede the current version';
  end if;

  update public.budgets set end_month=(p_effective_month - interval '1 month')::date, archived_at=now(), updated_at=now()
  where id=v_current.id returning * into v_row;
  return v_row;
end $$;

revoke all on function public.create_budget_target(public.data_scope,uuid,bigint,date) from public,anon;
revoke all on function public.revise_budget_target(uuid,bigint,date) from public,anon;
revoke all on function public.archive_budget_target(uuid,date) from public,anon;
grant execute on function public.create_budget_target(public.data_scope,uuid,bigint,date) to authenticated;
grant execute on function public.revise_budget_target(uuid,bigint,date) to authenticated;
grant execute on function public.archive_budget_target(uuid,date) to authenticated;
