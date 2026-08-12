-- GH-7: scoped categories, immutable Plaid defaults, and durable merchant rules.
create type public.merchant_match_type as enum ('merchant_id','normalized_name');
grant usage on type public.merchant_match_type to authenticated, service_role;
alter table public.categories add column system_key text;
alter table public.categories add constraint categories_system_key_stable unique (workspace_id,system_key);
update public.categories
set archived_at = now()
where scope = 'family'
  and archived_at is null
  and system_key is null
  and lower(name) in (
    'income','transfer in','transfer out','food & drink','groceries','restaurants',
    'general merchandise','transportation','rent & utilities','medical','entertainment',
    'personal care','travel','loan payments','bank fees','government & nonprofit',
    'home improvement','general services','uncategorized'
  );
drop index if exists public.categories_active_family_name_idx;
create unique index categories_active_family_name_idx on public.categories (workspace_id, lower(name)) where archived_at is null and scope = 'family';
alter table public.merchant_rules add column match_type public.merchant_match_type not null default 'normalized_name';
alter table public.merchant_rules drop constraint merchant_rules_match_normalized;
alter table public.merchant_rules add constraint merchant_rules_match_normalized check (
  (match_type = 'normalized_name' and merchant_match = lower(trim(merchant_match)) and length(merchant_match) > 0)
  or (match_type = 'merchant_id' and length(trim(merchant_match)) > 0)
);
drop index if exists public.merchant_rules_match_idx;
create unique index merchant_rules_active_match_idx on public.merchant_rules(workspace_id,scope,coalesce(owner_profile_id,'00000000-0000-0000-0000-000000000000'::uuid),match_type,merchant_match) where enabled and archived_at is null;
alter table public.merchant_rules add constraint merchant_rules_match_safe check(length(trim(merchant_match)) between 2 and 240);

create or replace function private.normalize_merchant_name(p_value text)
returns text language plpgsql immutable set search_path=pg_catalog as $$
declare v text;
begin
  if p_value is null then return null; end if;
  v := trim(lower(regexp_replace(normalize(p_value,NFKC),'\s+',' ','g')));
  if length(v) < 2 or v !~ '[[:alnum:]]' then return null; end if;
  return v;
end$$;
create or replace function private.transaction_merchant_match(p_merchant_name text,p_name text)
returns text language sql immutable set search_path=pg_catalog as $$
  select coalesce(private.normalize_merchant_name(p_merchant_name),private.normalize_merchant_name(p_name));
$$;
revoke all on function private.normalize_merchant_name(text) from public,anon;
revoke all on function private.transaction_merchant_match(text,text) from public,anon;
grant execute on function private.normalize_merchant_name(text) to authenticated;
grant execute on function private.transaction_merchant_match(text,text) to authenticated;

drop trigger merchant_rules_context_immutable on public.merchant_rules;
create trigger merchant_rules_context_immutable before update on public.merchant_rules for each row execute function private.enforce_immutable_columns('workspace_id','created_by','scope','owner_profile_id');

create or replace function private.seed_workspace_categories() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 insert into public.categories(workspace_id,created_by,name,color,scope,owner_profile_id,system_key)
 select new.id,new.owner_profile_id,v.name,v.color,'family',null,v.key from (values
 ('INCOME','Income','#4E7180'),('TRANSFER_IN','Transfer in','#4E7180'),('TRANSFER_OUT','Transfer out','#4E7180'),
 ('FOOD_AND_DRINK','Food & drink','#B76B45'),('FOOD_AND_DRINK_GROCERIES','Groceries','#698B55'),('FOOD_AND_DRINK_RESTAURANT','Restaurants','#B76B45'),
 ('GENERAL_MERCHANDISE','General merchandise','#7A6F62'),('TRANSPORTATION','Transportation','#4E7180'),('RENT_AND_UTILITIES','Rent & utilities','#8A7652'),
 ('MEDICAL','Medical','#A24F40'),('ENTERTAINMENT','Entertainment','#806A91'),('PERSONAL_CARE','Personal care','#A76F86'),
 ('TRAVEL','Travel','#477B74'),('LOAN_PAYMENTS','Loan payments','#786052'),('BANK_FEES','Bank fees','#A24F40'),('GOVERNMENT_AND_NON_PROFIT','Government & nonprofit','#617265'),('HOME_IMPROVEMENT','Home improvement','#8A7652'),('GENERAL_SERVICES','General services','#617265'),('UNCATEGORIZED','Uncategorized','#6B756E')
 ) as v(key,name,color) on conflict do nothing; return new;
end$$;
revoke all on function private.seed_workspace_categories() from public,anon,authenticated;
create trigger workspaces_seed_categories after insert on public.workspaces for each row execute function private.seed_workspace_categories();
insert into public.categories(workspace_id,created_by,name,color,scope,owner_profile_id,system_key)
select w.id,w.owner_profile_id,v.name,v.color,'family',null,v.key from public.workspaces w cross join (values
 ('INCOME','Income','#4E7180'),('TRANSFER_IN','Transfer in','#4E7180'),('TRANSFER_OUT','Transfer out','#4E7180'),('FOOD_AND_DRINK','Food & drink','#B76B45'),('FOOD_AND_DRINK_GROCERIES','Groceries','#698B55'),('FOOD_AND_DRINK_RESTAURANT','Restaurants','#B76B45'),('GENERAL_MERCHANDISE','General merchandise','#7A6F62'),('TRANSPORTATION','Transportation','#4E7180'),('RENT_AND_UTILITIES','Rent & utilities','#8A7652'),('MEDICAL','Medical','#A24F40'),('ENTERTAINMENT','Entertainment','#806A91'),('PERSONAL_CARE','Personal care','#A76F86'),('TRAVEL','Travel','#477B74'),('LOAN_PAYMENTS','Loan payments','#786052'),('BANK_FEES','Bank fees','#A24F40'),('GOVERNMENT_AND_NON_PROFIT','Government & nonprofit','#617265'),('HOME_IMPROVEMENT','Home improvement','#8A7652'),('GENERAL_SERVICES','General services','#617265'),('UNCATEGORIZED','Uncategorized','#6B756E'))v(key,name,color) on conflict do nothing;

create or replace function private.protect_system_category() returns trigger language plpgsql security definer set search_path=pg_catalog as $$ begin if old.system_key is not null and (new.name is distinct from old.name or new.archived_at is distinct from old.archived_at or new.system_key is distinct from old.system_key) then raise exception using errcode='23514',message='system category is immutable';end if;return new;end$$;
revoke all on function private.protect_system_category() from public,anon,authenticated;
create trigger categories_protect_system before update on public.categories for each row execute function private.protect_system_category();

create or replace view public.category_views with (security_invoker=true) as
select c.*,exists(select 1 from public.transaction_metadata m where m.category_id=c.id union all select 1 from public.merchant_rules r where r.category_id=c.id union all select 1 from public.manual_entries e where e.category_id=c.id union all select 1 from public.budgets b where b.category_id=c.id) in_use from public.categories c;
grant select on public.category_views to authenticated;
drop policy categories_delete on public.categories;
revoke delete on public.categories from authenticated;
drop policy merchant_rules_insert on public.merchant_rules;
revoke insert on public.merchant_rules from authenticated;
drop policy merchant_rules_update on public.merchant_rules;
revoke update on public.merchant_rules from authenticated;

create or replace function public.set_manual_transaction_category(p_transaction_id uuid,p_category_id uuid) returns boolean language plpgsql security invoker set search_path=pg_catalog as $$
declare t record;
begin select tx.workspace_id,a.scope,a.owner_profile_id into t from public.transactions tx join public.accounts a on a.id=tx.account_id where tx.id=p_transaction_id and tx.removed_at is null;if not found then return false;end if;if not exists(select 1 from public.categories c where c.id=p_category_id and c.workspace_id=t.workspace_id and c.scope=t.scope and c.owner_profile_id is not distinct from t.owner_profile_id and c.archived_at is null)then return false;end if;insert into public.transaction_metadata(transaction_id,workspace_id,updated_by,scope,owner_profile_id,category_id,merchant_rule_id)values(p_transaction_id,t.workspace_id,auth.uid(),t.scope,t.owner_profile_id,p_category_id,null)on conflict(transaction_id)do update set category_id=excluded.category_id,merchant_rule_id=null,updated_by=auth.uid(),updated_at=now();return true;end$$;
grant execute on function public.set_manual_transaction_category(uuid,uuid) to authenticated;

create or replace function public.preview_merchant_rule(p_transaction_id uuid,p_category_id uuid,p_scope public.data_scope,p_match_type public.merchant_match_type,p_match_value text) returns bigint language plpgsql security invoker set search_path=pg_catalog as $$
declare v_count bigint;v_workspace uuid;v_owner uuid;
begin select t.workspace_id,a.owner_profile_id into v_workspace,v_owner from public.transactions t join public.accounts a on a.id=t.account_id where t.id=p_transaction_id and a.scope=p_scope and a.owner_profile_id is not distinct from(case when p_scope='personal'then auth.uid() else null end) and t.removed_at is null;if not found or not exists(select 1 from public.categories c where c.id=p_category_id and c.workspace_id=v_workspace and c.scope=p_scope and c.owner_profile_id is not distinct from v_owner and c.archived_at is null)then return null;end if;select count(*) into v_count from public.transactions t join public.accounts a on a.id=t.account_id left join public.transaction_metadata m on m.transaction_id=t.id where t.workspace_id=v_workspace and a.scope=p_scope and a.owner_profile_id is not distinct from v_owner and t.removed_at is null and not(m.category_id is not null and m.merchant_rule_id is null) and(case when p_match_type='merchant_id'then t.provider_payload->>'stableMerchantId'=p_match_value else private.transaction_merchant_match(t.merchant_name,t.name)=p_match_value end);return v_count;end$$;
grant execute on function public.preview_merchant_rule(uuid,uuid,public.data_scope,public.merchant_match_type,text) to authenticated;

create or replace function public.create_merchant_rule(p_transaction_id uuid,p_category_id uuid,p_scope public.data_scope,p_match_type public.merchant_match_type,p_match_value text,p_apply_existing boolean) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_workspace uuid;v_owner uuid;v_rule public.merchant_rules%rowtype;v_count int:=0;v_preview bigint;v_expected_type public.merchant_match_type;v_expected_value text;
begin
  select t.workspace_id,a.owner_profile_id,
    case when nullif(trim(t.provider_payload->>'stableMerchantId'),'') is not null then 'merchant_id'::public.merchant_match_type else 'normalized_name'::public.merchant_match_type end,
    case when nullif(trim(t.provider_payload->>'stableMerchantId'),'') is not null then t.provider_payload->>'stableMerchantId' else private.transaction_merchant_match(t.merchant_name,t.name) end
  into v_workspace,v_owner,v_expected_type,v_expected_value
  from public.transactions t join public.accounts a on a.id=t.account_id
  where t.id=p_transaction_id and t.removed_at is null and private.is_active_member(t.workspace_id) and a.scope=p_scope
    and a.owner_profile_id is not distinct from(case when p_scope='personal'then auth.uid()else null end);
  if not found or v_expected_value is null or p_match_type<>v_expected_type or p_match_value<>v_expected_value then return null;end if;
  v_preview:=public.preview_merchant_rule(p_transaction_id,p_category_id,p_scope,p_match_type,p_match_value);
  if v_preview is null then return null;end if;
  insert into public.merchant_rules(workspace_id,created_by,merchant_match,match_type,category_id,scope,owner_profile_id)values(v_workspace,auth.uid(),p_match_value,p_match_type,p_category_id,p_scope,v_owner)returning * into v_rule;
  if p_apply_existing then insert into public.transaction_metadata(transaction_id,workspace_id,updated_by,scope,owner_profile_id,category_id,merchant_rule_id)select t.id,t.workspace_id,auth.uid(),p_scope,v_owner,p_category_id,v_rule.id from public.transactions t join public.accounts a on a.id=t.account_id left join public.transaction_metadata m on m.transaction_id=t.id where t.workspace_id=v_workspace and a.scope=p_scope and a.owner_profile_id is not distinct from v_owner and t.removed_at is null and not(m.category_id is not null and m.merchant_rule_id is null)and(case when p_match_type='merchant_id'then t.provider_payload->>'stableMerchantId'=p_match_value else private.transaction_merchant_match(t.merchant_name,t.name)=p_match_value end)on conflict(transaction_id)do update set category_id=excluded.category_id,merchant_rule_id=excluded.merchant_rule_id,updated_by=auth.uid(),updated_at=now() where transaction_metadata.merchant_rule_id is not null;get diagnostics v_count=row_count;end if;
  return jsonb_build_object('rule',(to_jsonb(v_rule) - 'merchant_match') || jsonb_build_object('match_value',v_rule.merchant_match),'updatedCount',v_count);
end$$;
grant execute on function public.create_merchant_rule(uuid,uuid,public.data_scope,public.merchant_match_type,text,boolean) to authenticated;

create or replace function public.update_merchant_rule(p_rule_id uuid,p_category_id uuid,p_enabled boolean,p_archived boolean)
returns public.merchant_rules language plpgsql security definer set search_path=pg_catalog as $$
declare v_rule public.merchant_rules%rowtype;
begin
  select * into v_rule from public.merchant_rules where id=p_rule_id and private.can_access_scoped_record(workspace_id,scope,owner_profile_id);
  if not found then return null; end if;
  if p_category_id is not null then
    if not exists(select 1 from public.categories c where c.id=p_category_id and c.workspace_id=v_rule.workspace_id and c.scope=v_rule.scope and c.owner_profile_id is not distinct from v_rule.owner_profile_id and c.archived_at is null) then return null; end if;
    if exists(select 1 from public.transaction_metadata where merchant_rule_id=p_rule_id) then raise exception using errcode='23514',message='used rule category is immutable'; end if;
  end if;
  update public.merchant_rules set
    category_id=coalesce(p_category_id,category_id),
    enabled=coalesce(p_enabled,enabled),
    archived_at=case when p_archived is null then archived_at when p_archived then now() else null end,
    updated_at=now()
  where id=p_rule_id returning * into v_rule;
  return v_rule;
end$$;
grant execute on function public.update_merchant_rule(uuid,uuid,boolean,boolean) to authenticated;

create or replace function private.apply_rule_after_plaid_sync()returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare a record;r record;
begin if exists(select 1 from public.transaction_metadata m where m.transaction_id=new.id and m.category_id is not null and m.merchant_rule_id is null)then return new;end if;select scope,owner_profile_id into a from public.accounts where id=new.account_id;select * into r from public.merchant_rules where workspace_id=new.workspace_id and scope=a.scope and owner_profile_id is not distinct from a.owner_profile_id and enabled and archived_at is null and(case when match_type='merchant_id'then new.provider_payload->>'stableMerchantId'=merchant_match else private.transaction_merchant_match(new.merchant_name,new.name)=merchant_match end)order by priority desc,created_at limit 1;if found then insert into public.transaction_metadata(transaction_id,workspace_id,updated_by,scope,owner_profile_id,category_id,merchant_rule_id)values(new.id,new.workspace_id,r.created_by,a.scope,a.owner_profile_id,r.category_id,r.id)on conflict(transaction_id)do update set category_id=excluded.category_id,merchant_rule_id=excluded.merchant_rule_id,updated_by=excluded.updated_by,updated_at=now()where transaction_metadata.merchant_rule_id is not null;end if;return new;end$$;
revoke all on function private.apply_rule_after_plaid_sync() from public,anon,authenticated;
create trigger transactions_apply_rule after insert or update of merchant_name,name,provider_payload,removed_at on public.transactions for each row when(new.removed_at is null)execute function private.apply_rule_after_plaid_sync();

create or replace function private.audit_shared_category_rule() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare v_row record;v_action text;
begin if tg_op='DELETE' then v_row:=old; else v_row:=new; end if;if v_row.scope<>'family'then return v_row;end if;v_action:=lower(tg_table_name)||'.'||lower(tg_op);insert into public.audit_events(workspace_id,actor_profile_id,action,target_type,target_id,scope,details)values(v_row.workspace_id,auth.uid(),v_action,tg_table_name,v_row.id,'family',jsonb_build_object('at',now()));return v_row;end$$;
revoke all on function private.audit_shared_category_rule() from public,anon,authenticated;
create trigger categories_audit_shared after insert or update on public.categories for each row execute function private.audit_shared_category_rule();
create trigger merchant_rules_audit_shared after insert or update on public.merchant_rules for each row execute function private.audit_shared_category_rule();

create or replace function private.audit_shared_manual_category() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin if new.scope='family' and new.category_id is not null then insert into public.audit_events(workspace_id,actor_profile_id,action,target_type,target_id,scope,details) values(new.workspace_id,new.updated_by,case when new.merchant_rule_id is null then 'transaction.category.manual' else 'merchant_rule.apply' end,'transaction',new.transaction_id,'family',jsonb_build_object('categoryId',new.category_id,'merchantRuleId',new.merchant_rule_id,'affectedCount',1,'at',now()));end if;return new;end$$;
revoke all on function private.audit_shared_manual_category() from public,anon,authenticated;
create trigger transaction_metadata_audit_manual after insert or update of category_id,merchant_rule_id on public.transaction_metadata for each row execute function private.audit_shared_manual_category();

