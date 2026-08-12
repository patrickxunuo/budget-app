-- GH-8: auditable manual/cash ledger with privacy-domain category invariants.
do $$ begin
  create type public.manual_entry_kind as enum ('income', 'spending', 'refund');
exception when duplicate_object then null; end $$;
grant usage on type public.manual_entry_kind to authenticated, service_role;

alter table public.manual_entries
  add column if not exists kind public.manual_entry_kind,
  add column if not exists notes text,
  add column if not exists last_edited_by uuid references public.profiles(id) on delete restrict,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete restrict;

update public.manual_entries
set kind = case when amount < 0 then 'spending'::public.manual_entry_kind else 'income'::public.manual_entry_kind end,
    last_edited_by = created_by
where kind is null or last_edited_by is null;

alter table public.manual_entries
  alter column kind set not null,
  alter column last_edited_by set not null,
  alter column category_id set not null;

alter table public.manual_entries drop constraint if exists manual_entries_amount_kind_valid;
alter table public.manual_entries add constraint manual_entries_amount_kind_valid check (
  (kind = 'spending' and amount < 0) or (kind in ('income', 'refund') and amount > 0)
);
alter table public.manual_entries drop constraint if exists manual_entries_description_length;
alter table public.manual_entries add constraint manual_entries_description_length check (length(trim(description)) between 1 and 160);
alter table public.manual_entries drop constraint if exists manual_entries_notes_length;
alter table public.manual_entries add constraint manual_entries_notes_length check (notes is null or length(notes) <= 1000);
alter table public.manual_entries drop constraint if exists manual_entries_deletion_audit_complete;
alter table public.manual_entries add constraint manual_entries_deletion_audit_complete check ((deleted_at is null) = (deleted_by is null));

create index if not exists manual_entries_visible_date_idx on public.manual_entries (workspace_id, entry_date desc) where deleted_at is null;

-- Scope, ownership, authorship and source identity never change after creation.
drop trigger if exists manual_entries_context_immutable on public.manual_entries;
create trigger manual_entries_context_immutable before update on public.manual_entries for each row
  execute function private.enforce_immutable_columns('workspace_id', 'created_by', 'scope', 'owner_profile_id', 'currency_code');

create or replace function private.prevent_manual_entry_hard_delete()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  raise exception using errcode = '23514', message = 'manual entries must be soft deleted';
end $$;
revoke all on function private.prevent_manual_entry_hard_delete() from public, anon, authenticated;
drop trigger if exists manual_entries_no_hard_delete on public.manual_entries;
create trigger manual_entries_no_hard_delete before delete on public.manual_entries for each row execute function private.prevent_manual_entry_hard_delete();

drop policy if exists manual_entries_delete on public.manual_entries;
revoke insert, update, delete on public.manual_entries from authenticated;

create or replace function public.create_manual_entry(
  p_scope public.data_scope, p_kind public.manual_entry_kind, p_amount numeric,
  p_entry_date date, p_description text, p_category_id uuid, p_notes text
) returns public.manual_entries
language plpgsql security definer set search_path = pg_catalog as $$
declare v_workspace uuid; v_owner uuid; v_row public.manual_entries%rowtype;
begin
  select m.workspace_id into v_workspace from public.workspace_memberships m
  where m.profile_id = auth.uid() and m.status = 'active' limit 1;
  if v_workspace is null then raise exception using errcode='42501',message='active membership required'; end if;
  v_owner := case when p_scope='personal' then auth.uid() else null end;
  if not exists(select 1 from public.categories c where c.id=p_category_id and c.workspace_id=v_workspace and c.scope=p_scope and c.owner_profile_id is not distinct from v_owner and c.archived_at is null) then
    raise exception using errcode='23503',message='category is not available in this privacy scope';
  end if;
  insert into public.manual_entries(workspace_id,created_by,last_edited_by,scope,owner_profile_id,kind,amount,currency_code,entry_date,description,category_id,notes)
  values(v_workspace,auth.uid(),auth.uid(),p_scope,v_owner,p_kind,p_amount,'CAD',p_entry_date,trim(p_description),p_category_id,nullif(trim(p_notes),'')) returning * into v_row;
  return v_row;
end $$;

create or replace function public.update_manual_entry(
  p_id uuid, p_kind public.manual_entry_kind, p_amount numeric, p_entry_date date,
  p_description text, p_category_id uuid, p_notes text
) returns public.manual_entries
language plpgsql security definer set search_path = pg_catalog as $$
declare v_row public.manual_entries%rowtype;
begin
  select * into v_row from public.manual_entries e where e.id=p_id and e.deleted_at is null
    and private.can_access_scoped_record(e.workspace_id,e.scope,e.owner_profile_id);
  if not found then return null; end if;
  if not exists(select 1 from public.categories c where c.id=p_category_id and c.workspace_id=v_row.workspace_id and c.scope=v_row.scope and c.owner_profile_id is not distinct from v_row.owner_profile_id and c.archived_at is null) then
    raise exception using errcode='23503',message='category is not available in this privacy scope';
  end if;
  update public.manual_entries set kind=p_kind,amount=p_amount,entry_date=p_entry_date,description=trim(p_description),category_id=p_category_id,
    notes=nullif(trim(p_notes),''),last_edited_by=auth.uid(),updated_at=now()
  where id=p_id returning * into v_row;
  return v_row;
end $$;

create or replace function public.soft_delete_manual_entry(p_id uuid, p_confirmed boolean)
returns public.manual_entries language plpgsql security definer set search_path = pg_catalog as $$
declare v_row public.manual_entries%rowtype;
begin
  select * into v_row from public.manual_entries e where e.id=p_id and e.deleted_at is null
    and private.can_access_scoped_record(e.workspace_id,e.scope,e.owner_profile_id);
  if not found then return null; end if;
  if v_row.scope='family' and p_confirmed is not true then raise exception using errcode='22023',message='family deletion requires confirmation'; end if;
  update public.manual_entries set deleted_at=now(),deleted_by=auth.uid(),last_edited_by=auth.uid(),updated_at=now() where id=p_id returning * into v_row;
  return v_row;
end $$;

revoke all on function public.create_manual_entry(public.data_scope,public.manual_entry_kind,numeric,date,text,uuid,text) from public,anon;
revoke all on function public.update_manual_entry(uuid,public.manual_entry_kind,numeric,date,text,uuid,text) from public,anon;
revoke all on function public.soft_delete_manual_entry(uuid,boolean) from public,anon;
grant execute on function public.create_manual_entry(public.data_scope,public.manual_entry_kind,numeric,date,text,uuid,text) to authenticated;
grant execute on function public.update_manual_entry(uuid,public.manual_entry_kind,numeric,date,text,uuid,text) to authenticated;
grant execute on function public.soft_delete_manual_entry(uuid,boolean) to authenticated;

create or replace function private.audit_family_manual_entry()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if new.scope='family' then
    insert into public.audit_events(workspace_id,actor_profile_id,action,target_type,target_id,scope,details)
    values(new.workspace_id,auth.uid(),case when tg_op='INSERT' then 'manual_entry.create' when old.deleted_at is null and new.deleted_at is not null then 'manual_entry.delete' else 'manual_entry.update' end,
      'manual_entry',new.id,'family',jsonb_build_object('createdBy',new.created_by,'lastEditedBy',new.last_edited_by,'deletedBy',new.deleted_by,'at',now()));
  end if;
  return new;
end $$;
revoke all on function private.audit_family_manual_entry() from public,anon,authenticated;
drop trigger if exists manual_entries_audit_family on public.manual_entries;
create trigger manual_entries_audit_family after insert or update on public.manual_entries for each row execute function private.audit_family_manual_entry();
