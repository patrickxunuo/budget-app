begin;
set local search_path = public, extensions;
select no_plan();

-- Stable auth identities; every public primitive must derive caller identity from auth.uid().
insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
('b3000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-gh3@example.test', '', now(), '{}', '{}', now(), now()),
('b3000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member-gh3@example.test', '', now(), '{}', '{}', now(), now()),
('b3000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other-gh3@example.test', '', now(), '{}', '{}', now(), now());

set local role service_role;

-- API-001: the bootstrap primitive serializes first-family setup and creates one active owner.
select lives_ok(
  $$select public.setup_family('b3000000-0000-0000-0000-000000000001', 'owner-gh3@example.test', 'GH-3 Owner', 'GH-3 Household')$$,
  'API-001 first setup atomically creates the singleton family and owner'
);
select ok(
  (select count(*) = 1 from public.workspaces where singleton_key)
  and (select count(*) = 1 from public.workspace_memberships where role = 'owner' and status = 'active'),
  'API-001 exactly one singleton workspace and active owner exist after setup'
);
select ok(
  pg_get_functiondef('public.setup_family(uuid,text,text,text)'::regprocedure) ~* 'pg_advisory_xact_lock|lock[[:space:]]+table',
  'API-001 setup takes a transaction-scoped serialization lock'
);

-- API-002: bypassing the setup UI cannot create another workspace.
select throws_ok(
  $$select public.setup_family('b3000000-0000-0000-0000-000000000003', 'other-gh3@example.test', 'Other Person', 'Other Household')$$,
  'P0001', null,
  'API-002 setup is rejected by the backend after a workspace exists'
);
select is((select count(*) from public.workspaces), 1::bigint, 'API-002 rejected setup leaves no side effects');
select ok(
  not has_function_privilege('authenticated', 'public.setup_family(uuid,text,text,text)', 'EXECUTE'),
  'API-002 browser-authenticated callers cannot invoke family setup directly'
);

-- Return to owner for invitation administration.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000001","email":"owner-gh3@example.test","role":"authenticated"}', true);

-- API-003: only a digest is persisted and revocation makes the invitation unusable.
select lives_ok(
  $$select public.create_invitation('revoked-gh3@example.test', encode(digest('revoked-token-gh3', 'sha256'), 'hex'), now() + interval '24 hours')$$,
  'API-003 owner creates an invitation through the transactional primitive'
);
select ok(
  exists (
    select 1 from public.invitations
    where email = 'revoked-gh3@example.test'
      and token_hash = encode(digest('revoked-token-gh3', 'sha256'), 'hex')
      and token_hash <> 'revoked-token-gh3'
  ),
  'API-003 the database stores only the SHA-256 token hash'
);
select lives_ok(
  $$select public.revoke_invitation((select id from public.invitations where email = 'revoked-gh3@example.test'))$$,
  'API-003 owner revokes an unresolved invitation'
);
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000003","email":"revoked-gh3@example.test","role":"authenticated"}', true);
set local role service_role;
select throws_ok(
  $$select public.accept_invitation('b3000000-0000-0000-0000-000000000003', 'other-gh3@example.test', encode(digest('revoked-token-gh3', 'sha256'), 'hex'), 'Revoked Invitee')$$,
  'P0001', null,
  'API-003 a revoked token cannot be accepted'
);

-- API-004: matching-email acceptance creates profile + membership and consumes once.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000001","email":"owner-gh3@example.test","role":"authenticated"}', true);
select public.create_invitation('member-gh3@example.test', encode(digest('member-token-gh3', 'sha256'), 'hex'), now() + interval '24 hours');
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000002","email":"member-gh3@example.test","role":"authenticated"}', true);
set local role service_role;
select lives_ok(
  $$select public.accept_invitation('b3000000-0000-0000-0000-000000000002', 'member-gh3@example.test', encode(digest('member-token-gh3', 'sha256'), 'hex'), 'GH-3 Member')$$,
  'API-004 a matching invitee accepts exactly once'
);
select ok(
  exists(select 1 from public.profiles where id = 'b3000000-0000-0000-0000-000000000002')
  and exists(select 1 from public.workspace_memberships where profile_id = 'b3000000-0000-0000-0000-000000000002' and role = 'member' and status = 'active')
  and exists(select 1 from public.invitations where email = 'member-gh3@example.test' and accepted_at is not null and revoked_at is null),
  'API-004 profile, active membership, and accepted_at commit atomically'
);
-- API-005: replay, expiry, and email mismatch share rejection behavior and have no membership side effects.
select throws_ok(
  $$select public.accept_invitation('b3000000-0000-0000-0000-000000000002', 'member-gh3@example.test', encode(digest('member-token-gh3', 'sha256'), 'hex'), 'GH-3 Member Again')$$,
  'P0001', null,
  'API-005 an accepted invitation cannot be replayed'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000001","email":"owner-gh3@example.test","role":"authenticated"}', true);
set local role service_role;
insert into public.invitations(workspace_id, email, invited_by, token_hash, created_at, expires_at)
select id, 'expired-gh3@example.test', 'b3000000-0000-0000-0000-000000000001', encode(digest('expired-token-gh3', 'sha256'), 'hex'), now() - interval '2 hours', now() - interval '1 minute'
from public.workspaces;
set local role authenticated;
select public.create_invitation('other-gh3@example.test', encode(digest('mismatch-token-gh3', 'sha256'), 'hex'), now() + interval '24 hours');
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000003","email":"wrong-address-gh3@example.test","role":"authenticated"}', true);
set local role service_role;
select throws_ok(
  $$select public.accept_invitation('b3000000-0000-0000-0000-000000000003', 'other-gh3@example.test', encode(digest('expired-token-gh3', 'sha256'), 'hex'), 'Other Person')$$,
  'P0001', null,
  'API-005 an expired invitation is generically rejected'
);
select throws_ok(
  $$select public.accept_invitation('b3000000-0000-0000-0000-000000000003', 'wrong-address-gh3@example.test', encode(digest('mismatch-token-gh3', 'sha256'), 'hex'), 'Other Person')$$,
  '42501', null,
  'API-005 an invitation finalized with a mismatched verified email is rejected'
);
select ok(
  not exists(select 1 from public.profiles where id = 'b3000000-0000-0000-0000-000000000003')
  and not exists(select 1 from public.workspace_memberships where profile_id = 'b3000000-0000-0000-0000-000000000003'),
  'API-005 rejected invitations create no profile or membership'
);
select ok(
  not has_function_privilege('authenticated', 'public.accept_invitation(uuid,text,text,text)', 'EXECUTE'),
  'API-005 browser-authenticated callers cannot finalize invitations directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.invitations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.invitations', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.invitations', 'DELETE'),
  'API-006 invitation lifecycle writes are available only through guarded functions'
);

-- API-006: member and anonymous callers cannot manage invitations.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000002","email":"member-gh3@example.test","role":"authenticated"}', true);
select throws_ok(
  $$select public.create_invitation('forbidden-gh3@example.test', encode(digest('forbidden-token-gh3', 'sha256'), 'hex'), now() + interval '24 hours')$$,
  '42501', null,
  'API-006 an active member cannot create invitations'
);
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
select throws_ok(
  $$select public.revoke_invitation('00000000-0000-0000-0000-000000000000')$$,
  '42501', null,
  'API-006 an anonymous caller cannot manage invitations'
);

-- API-007: ownership transfer changes both roles and the workspace pointer atomically.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000001","email":"owner-gh3@example.test","role":"authenticated"}', true);
set local role service_role;
select public.mark_recent_password_confirmation('b3000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.transfer_ownership((select id from public.workspace_memberships where profile_id = 'b3000000-0000-0000-0000-000000000002'))$$,
  'API-007 owner transfers ownership to an active member'
);
set constraints all immediate;
select ok(
  (select owner_profile_id = 'b3000000-0000-0000-0000-000000000002' from public.workspaces)
  and (select role = 'member' from public.workspace_memberships where profile_id = 'b3000000-0000-0000-0000-000000000001')
  and (select role = 'owner' from public.workspace_memberships where profile_id = 'b3000000-0000-0000-0000-000000000002')
  and (select count(*) = 1 from public.workspace_memberships where role = 'owner' and status = 'active'),
  'API-007 workspace pointer and both membership roles change atomically with one owner'
);
set constraints all deferred;

-- API-008: the sole owner cannot depart before another ownership transfer.
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000002","email":"member-gh3@example.test","role":"authenticated"}', true);
set local role service_role;
select public.mark_recent_password_confirmation('b3000000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.leave_workspace()$$,
  '42501', null,
  'API-008 the sole active owner cannot leave or delete their account'
);

-- API-009: departure deactivates access, removes Personal data, revokes Plaid, and preserves Family history.
reset role;
insert into public.plaid_items(id, workspace_id, linked_by, plaid_item_id, institution_id, institution_name, access_token_ciphertext, access_token_key_version, status)
select 'b3300000-0000-0000-0000-000000000001', id, 'b3000000-0000-0000-0000-000000000001', 'gh3-item', 'gh3-bank', 'GH-3 Bank', decode('0102','hex'), 1, 'active' from public.workspaces;
insert into public.accounts(id, workspace_id, plaid_item_id, linked_by, provider_account_id, type, subtype, currency_code, name, scope, owner_profile_id)
select 'b3400000-0000-0000-0000-000000000001', id, 'b3300000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001', 'gh3-personal', 'depository', 'chequing', 'CAD', 'Personal account', 'personal', 'b3000000-0000-0000-0000-000000000001' from public.workspaces;
reset role;
insert into public.audit_events(workspace_id, actor_profile_id, action, scope, owner_profile_id, details)
select id, 'b3000000-0000-0000-0000-000000000001', 'gh3.family.history', 'family', null, '{}' from public.workspaces;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000001","email":"owner-gh3@example.test","role":"authenticated"}', true);
set local role service_role;
select public.mark_recent_password_confirmation('b3000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$select public.leave_workspace()$$, 'API-009 an active member leaves through the cleanup primitive');
set local role service_role;
select ok(
  exists(select 1 from public.workspace_memberships where profile_id = 'b3000000-0000-0000-0000-000000000001' and status = 'inactive')
  and not exists(select 1 from public.accounts where owner_profile_id = 'b3000000-0000-0000-0000-000000000001' and scope = 'personal')
  and exists(select 1 from public.plaid_items where linked_by = 'b3000000-0000-0000-0000-000000000001' and status <> 'active')
  and exists(select 1 from public.audit_events where action = 'gh3.family.history'),
  'API-009 membership is inactive, Personal data is deleted, Plaid is revoked, and Family history remains'
);
select ok(
  not has_function_privilege('authenticated', 'public.mark_recent_password_confirmation(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.mark_recent_password_confirmation(uuid)', 'EXECUTE'),
  'API-010 only the trusted server can record recent password confirmation'
);

-- API-010: destructive actions reject otherwise-authorized callers without fresh confirmation.
reset role;
delete from public.recent_auth_confirmations where profile_id = 'b3000000-0000-0000-0000-000000000002';
insert into public.profiles(id, display_name) values ('b3000000-0000-0000-0000-000000000003', 'Removable Member');
insert into public.workspace_memberships(workspace_id, profile_id, role, status)
select id, 'b3000000-0000-0000-0000-000000000003', 'member', 'active' from public.workspaces;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000002","email":"member-gh3@example.test","role":"authenticated"}', true);
select throws_ok(
  $$select public.remove_member((select id from public.workspace_memberships where profile_id = 'b3000000-0000-0000-0000-000000000003'))$$,
  '42501', null,
  'API-010 an authorized owner without recent password confirmation cannot remove a member'
);
select ok(
  exists(select 1 from public.workspace_memberships where profile_id = 'b3000000-0000-0000-0000-000000000003' and status = 'active'),
  'API-010 rejected destructive action has no membership side effect'
);
select throws_ok(
  $$update public.workspace_memberships set status='inactive' where profile_id='b3000000-0000-0000-0000-000000000003'$$,
  '42501', null,
  'API-010 an owner cannot bypass recent confirmation with direct membership DML'
);
select ok(
  not has_table_privilege('authenticated', 'public.workspace_memberships', 'INSERT')
  and not has_table_privilege('authenticated', 'public.workspace_memberships', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.workspace_memberships', 'DELETE'),
  'API-010 membership writes are available only through guarded functions'
);

-- API-010: even a recently confirmed owner cannot delete a workspace while members remain.
set local role service_role;
select public.mark_recent_password_confirmation('b3000000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.delete_workspace('GH-3 Household')$$,
  '42501', null,
  'API-010 workspace deletion is rejected while another active member remains'
);
select ok(
  exists(select 1 from public.workspaces)
  and exists(select 1 from public.workspace_memberships where profile_id='b3000000-0000-0000-0000-000000000003' and status='active'),
  'API-010 rejected workspace deletion leaves the workspace and membership intact'
);

-- API-010 security surface: primitives are unavailable to anonymous callers and hardened.
select ok(
  not has_function_privilege('anon', 'public.transfer_ownership(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.leave_workspace()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.remove_member(uuid)', 'EXECUTE'),
  'API-010 anonymous callers cannot invoke destructive membership primitives'
);
select ok(
  (select prosecdef and coalesce(array_to_string(proconfig, ','), '') ~ 'search_path=' from pg_proc where oid = 'public.transfer_ownership(uuid)'::regprocedure)
  and (select prosecdef and coalesce(array_to_string(proconfig, ','), '') ~ 'search_path=' from pg_proc where oid = 'public.leave_workspace()'::regprocedure)
  and (select prosecdef and coalesce(array_to_string(proconfig, ','), '') ~ 'search_path=' from pg_proc where oid = 'public.remove_member(uuid)'::regprocedure),
  'API-010 destructive membership primitives are security-definer functions with fixed search paths'
);

select * from finish();
rollback;
