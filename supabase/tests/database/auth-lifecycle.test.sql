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

-- GH-14 DB-002: invitation validity bounds. `create_invitation` is the only
-- writer, so its expiry window is the whole guard against a perpetual invite
-- link or an already-dead one being minted.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000001","email":"owner-gh3@example.test","role":"authenticated"}', true);
select throws_ok(
  $$select public.create_invitation('past-gh14@example.test', encode(digest('past-token-gh14','sha256'),'hex'), now() - interval '1 minute')$$,
  '22023', null,
  'GH-14 DB-002 an already-expired invitation is rejected at creation'
);
select throws_ok(
  $$select public.create_invitation('forever-gh14@example.test', encode(digest('forever-token-gh14','sha256'),'hex'), now() + interval '169 hours')$$,
  '22023', null,
  'GH-14 DB-002 an invitation cannot outlive the seven-day maximum'
);
select lives_ok(
  $$select public.create_invitation('bounds-gh14@example.test', encode(digest('bounds-token-gh14','sha256'),'hex'), now() + interval '168 hours')$$,
  'GH-14 DB-002 an invitation exactly at the seven-day maximum is accepted'
);
select is(
  (select count(*) from public.invitations where email in ('past-gh14@example.test','forever-gh14@example.test')),
  0::bigint,
  'GH-14 DB-002 a rejected expiry writes no invitation row'
);

-- GH-14 DB-003: revocation is terminal, and it is an owner-only authority.
select lives_ok(
  $$select public.revoke_invitation((select id from public.invitations where email='bounds-gh14@example.test'))$$,
  'GH-14 DB-003 the owner revokes an unresolved invitation'
);
select throws_ok(
  $$select public.revoke_invitation((select id from public.invitations where email='bounds-gh14@example.test'))$$,
  'P0002', null,
  'GH-14 DB-003 a revoked invitation cannot be revoked again'
);
select throws_ok(
  $$select public.revoke_invitation((select id from public.invitations where email='member-gh3@example.test'))$$,
  'P0002', null,
  'GH-14 DB-003 an accepted invitation can no longer be revoked'
);
select public.create_invitation('member-revoke-gh14@example.test', encode(digest('member-revoke-token-gh14','sha256'),'hex'), now() + interval '24 hours');
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000002","email":"member-gh3@example.test","role":"authenticated"}', true);
select throws_ok(
  $$select public.revoke_invitation((select id from public.invitations where email='member-revoke-gh14@example.test'))$$,
  'P0002', null,
  'GH-14 DB-003 an active member cannot revoke a live invitation'
);
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000001","email":"owner-gh3@example.test","role":"authenticated"}', true);
select lives_ok(
  $$select public.revoke_invitation((select id from public.invitations where email='member-revoke-gh14@example.test'))$$,
  'GH-14 DB-003 the owner revokes the same invitation, so the member denial was authorization and not invitation state'
);

-- API-007: ownership transfer changes both roles and the workspace pointer atomically.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000001","email":"owner-gh3@example.test","role":"authenticated"}', true);

-- GH-14 DB-004: recent reauthentication is a precondition of every ownership
-- change, and the window is bounded on both sides. A 42501 means the caller
-- never passed the confirmation gate; a 22023 means it did and only the
-- target was wrong, which is how the boundary is proved rather than assumed.
select throws_ok(
  $$select public.transfer_ownership((select id from public.workspace_memberships where profile_id = 'b3000000-0000-0000-0000-000000000002'))$$,
  '42501', null,
  'GH-14 DB-004 ownership transfer is refused with no recent password confirmation at all'
);
set local role service_role;
select public.mark_recent_password_confirmation('b3000000-0000-0000-0000-000000000001');
update public.recent_auth_confirmations set confirmed_at = now() - interval '20 minutes'
where profile_id = 'b3000000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok(
  $$select public.transfer_ownership((select id from public.workspace_memberships where profile_id = 'b3000000-0000-0000-0000-000000000002'))$$,
  '42501', null,
  'GH-14 DB-004 a password confirmation older than the reauthentication window no longer authorizes a transfer'
);
set local role service_role;
update public.recent_auth_confirmations set confirmed_at = now() - interval '14 minutes'
where profile_id = 'b3000000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok(
  $$select public.transfer_ownership('00000000-0000-0000-0000-000000000000')$$,
  '22023', null,
  'GH-14 DB-004 a confirmation inside the window authorizes the caller and fails only on the invalid target'
);
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000002","email":"member-gh3@example.test","role":"authenticated"}', true);
select throws_ok(
  $$select public.transfer_ownership((select id from public.workspace_memberships where profile_id = 'b3000000-0000-0000-0000-000000000002'))$$,
  '42501', null,
  'GH-14 DB-004 an ordinary member cannot promote themselves to owner'
);
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000001","email":"owner-gh3@example.test","role":"authenticated"}', true);
select ok(
  (select owner_profile_id = 'b3000000-0000-0000-0000-000000000001' from public.workspaces)
  and (select role = 'owner' from public.workspace_memberships where profile_id = 'b3000000-0000-0000-0000-000000000001')
  and (select role = 'member' from public.workspace_memberships where profile_id = 'b3000000-0000-0000-0000-000000000002'),
  'GH-14 DB-004 every rejected transfer leaves the workspace owner pointer and both roles unchanged'
);

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

-- GH-12 DB-001: authenticated callers cannot bypass recent confirmation or ownership guards.
reset role;
set local role service_role;
delete from public.recent_auth_confirmations where profile_id = 'b3000000-0000-0000-0000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000003","email":"other-gh3@example.test","role":"authenticated"}', true);
select throws_ok(
  $$select public.finalize_account_deletion()$$,
  '42501', null,
  'GH-12 DB-001 account finalization rejects a caller without recent confirmation'
);
select throws_ok(
  $$select public.finalize_workspace_deletion(
    'b3000000-0000-0000-0000-000000000003',
    'GH-3 Household',
    true
  )$$,
  '42501', null,
  'GH-12 DB-001 authenticated callers cannot execute workspace finalization'
);
select throws_ok(
  $$select public.finalize_workspace_deletion(
    'b3000000-0000-0000-0000-000000000002',
    'GH-3 Household',
    false
  )$$,
  '42501', null,
  'GH-12 DB-001 an authenticated owner cannot bypass notification policy by passing false'
);
set local role service_role;
select throws_ok(
  $$select public.finalize_workspace_deletion(
    'b3000000-0000-0000-0000-000000000003',
    'GH-3 Household',
    false
  )$$,
  '42501', null,
  'GH-12 DB-001 the trusted finalizer rechecks that the explicit actor is the current active owner'
);
delete from public.recent_auth_confirmations
where profile_id = 'b3000000-0000-0000-0000-000000000002';
select throws_ok(
  $$select public.finalize_workspace_deletion(
    'b3000000-0000-0000-0000-000000000002',
    'GH-3 Household',
    false
  )$$,
  '42501', null,
  'GH-12 DB-001 the trusted finalizer rejects an owner with stale password confirmation'
);
select ok(
  exists(select 1 from public.workspaces)
  and exists(select 1 from public.workspace_memberships where profile_id = 'b3000000-0000-0000-0000-000000000003' and status = 'active'),
  'GH-12 DB-001 rejected finalization preserves the workspace graph'
);

-- Seed every major workspace graph for complete owner-requested finalization.
reset role;
set local role service_role;
select public.mark_recent_password_confirmation('b3000000-0000-0000-0000-000000000002');
insert into public.categories(id,workspace_id,created_by,name,color,scope)
select 'b3500000-0000-0000-0000-000000000001',id,'b3000000-0000-0000-0000-000000000002','GH-12 Groceries','#18745b','family' from public.workspaces;
insert into public.manual_entries(id,workspace_id,created_by,last_edited_by,scope,owner_profile_id,kind,amount,currency_code,entry_date,description,category_id,notes)
select 'b3600000-0000-0000-0000-000000000001',id,'b3000000-0000-0000-0000-000000000003','b3000000-0000-0000-0000-000000000003','family',null,'spending',-12.34,'CAD',current_date,'GH-12 manual row','b3500000-0000-0000-0000-000000000001','delete me' from public.workspaces;
insert into public.budgets(id,workspace_id,created_by,category_id,currency_code,scope,amount_cents,effective_month,end_month)
select 'b3700000-0000-0000-0000-000000000001',id,'b3000000-0000-0000-0000-000000000002','b3500000-0000-0000-0000-000000000001','CAD','family',10000,date '2026-08-01',date '2026-08-01' from public.workspaces;
insert into public.merchant_rules(id,workspace_id,created_by,merchant_match,category_id,scope)
select 'b3800000-0000-0000-0000-000000000001',id,'b3000000-0000-0000-0000-000000000002','gh12 market','b3500000-0000-0000-0000-000000000001','family' from public.workspaces;
update public.plaid_items set status = 'revoked', disconnected_at = coalesce(disconnected_at, now());

-- GH-12 notification claims serialize delivery, adopt stale work, and preserve sent rows.
select is(
  public.claim_workspace_deletion_notification(
    (select id from public.workspaces),
    'b3000000-0000-0000-0000-000000000002',
    'c1200000-0000-4000-8000-000000000001'
  ),
  'claimed',
  'GH-12 first notification worker claims an unsent current member'
);
select is(
  public.claim_workspace_deletion_notification(
    (select id from public.workspaces),
    'b3000000-0000-0000-0000-000000000002',
    'c1200000-0000-4000-8000-000000000002'
  ),
  'busy',
  'GH-12 a concurrent fresh notification claim fails closed as busy'
);
select lives_ok(
  $$select public.release_workspace_deletion_notification(
    (select id from public.workspaces),
    'b3000000-0000-0000-0000-000000000002',
    'c1200000-0000-4000-8000-000000000001'
  )$$,
  'GH-12 definite unsent failure releases its matching claim'
);
select is(
  public.claim_workspace_deletion_notification(
    (select id from public.workspaces),
    'b3000000-0000-0000-0000-000000000002',
    'c1200000-0000-4000-8000-000000000002'
  ),
  'claimed',
  'GH-12 released unsent notification is claimable for retry'
);
select lives_ok(
  $$select public.mark_workspace_deletion_notification_sent(
    (select id from public.workspaces),
    'b3000000-0000-0000-0000-000000000002',
    'c1200000-0000-4000-8000-000000000002'
  )$$,
  'GH-12 successful SMTP marks the matching claim sent'
);
select lives_ok(
  $$select public.release_workspace_deletion_notification(
    (select id from public.workspaces),
    'b3000000-0000-0000-0000-000000000002',
    'c1200000-0000-4000-8000-000000000002'
  )$$,
  'GH-12 release is harmless after the row is sent'
);
select is(
  public.claim_workspace_deletion_notification(
    (select id from public.workspaces),
    'b3000000-0000-0000-0000-000000000002',
    'c1200000-0000-4000-8000-000000000003'
  ),
  'sent',
  'GH-12 sent notification is adopted without a duplicate send'
);
select is(
  public.claim_workspace_deletion_notification(
    (select id from public.workspaces),
    'b3000000-0000-0000-0000-000000000003',
    'c1200000-0000-4000-8000-000000000004'
  ),
  'claimed',
  'GH-12 another active member obtains an independent claim'
);
update public.workspace_deletion_notifications
set claimed_at=now()-interval '6 minutes'
where profile_id='b3000000-0000-0000-0000-000000000003';
select is(
  public.claim_workspace_deletion_notification(
    (select id from public.workspaces),
    'b3000000-0000-0000-0000-000000000003',
    'c1200000-0000-4000-8000-000000000005'
  ),
  'claimed',
  'GH-12 a claim older than five minutes is safely adopted by a retry'
);
select lives_ok(
  $$select public.mark_workspace_deletion_notification_sent(
    (select id from public.workspaces),
    'b3000000-0000-0000-0000-000000000003',
    'c1200000-0000-4000-8000-000000000005'
  )$$,
  'GH-12 adopted stale claim can be marked sent'
);
select ok(
  not has_table_privilege('anon', 'public.workspace_deletion_notifications', 'SELECT')
  and not has_table_privilege('authenticated', 'public.workspace_deletion_notifications', 'SELECT')
  and not has_table_privilege('authenticated', 'public.workspace_deletion_notifications', 'INSERT')
  and not has_table_privilege('authenticated', 'public.workspace_deletion_notifications', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.workspace_deletion_notifications', 'DELETE')
  and has_table_privilege('service_role', 'public.workspace_deletion_notifications', 'SELECT')
  and has_table_privilege('service_role', 'public.workspace_deletion_notifications', 'INSERT')
  and has_table_privilege('service_role', 'public.workspace_deletion_notifications', 'UPDATE')
  and not has_function_privilege('authenticated', 'public.claim_workspace_deletion_notification(uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.mark_workspace_deletion_notification_sent(uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.release_workspace_deletion_notification(uuid,uuid,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.claim_workspace_deletion_notification(uuid,uuid,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.mark_workspace_deletion_notification_sent(uuid,uuid,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.release_workspace_deletion_notification(uuid,uuid,uuid)', 'EXECUTE')
  and exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='workspace_deletion_notifications'
      and column_name='claim_id'
  )
  and exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='workspace_deletion_notifications'
      and column_name='claimed_at'
  )
  and exists(
    select 1 from pg_constraint
    where conrelid='public.workspace_deletion_notifications'::regclass
      and contype='p'
      and pg_get_constraintdef(oid) ~* '\(workspace_id, profile_id\)'
  ),
  'GH-12 DB notification sent-state ledger is service-only'
);
select is(
  (select count(*) from public.workspace_deletion_notifications),
  2::bigint,
  'GH-12 DB notification ledger records one durable sent state per workspace member'
);
-- A newly active member after the first notification pass must block finalization.
reset role;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('b3000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','late-gh12@example.test','',now(),'{}','{}',now(),now());
set local role service_role;
insert into public.profiles(id,display_name) values
('b3000000-0000-0000-0000-000000000004','Late GH-12 Member');
insert into public.workspace_memberships(workspace_id,profile_id,role,status)
select id,'b3000000-0000-0000-0000-000000000004','member','active' from public.workspaces;
set local role service_role;
select throws_ok(
  $$select public.finalize_workspace_deletion(
    'b3000000-0000-0000-0000-000000000002',
    'GH-3 Household',
    true
  )$$,
  'P0001', null,
  'GH-12 DB finalizer rejects when a newly active member has no sent notification row'
);
select ok(
  exists(select 1 from public.workspaces)
  and exists(
    select 1 from public.workspace_memberships
    where profile_id='b3000000-0000-0000-0000-000000000004' and status='active'
  ),
  'GH-12 rejected late-member finalization leaves the complete workspace intact'
);

-- Notify the late member through the same service-only claimed protocol, then retry.
set local role service_role;
select is(
  public.claim_workspace_deletion_notification(
    (select id from public.workspaces),
    'b3000000-0000-0000-0000-000000000004',
    'c1200000-0000-4000-8000-000000000006'
  ),
  'claimed',
  'GH-12 late active member can be claimed for notification on retry'
);
select lives_ok(
  $$select public.mark_workspace_deletion_notification_sent(
    (select id from public.workspaces),
    'b3000000-0000-0000-0000-000000000004',
    'c1200000-0000-4000-8000-000000000006'
  )$$,
  'GH-12 late active member notification becomes durable'
);
set local role service_role;
select lives_ok(
  $$select public.finalize_workspace_deletion(
    'b3000000-0000-0000-0000-000000000002',
    'GH-3 Household',
    true
  )$$,
  'GH-12 DB-002 service-role finalization succeeds for a recently confirmed current owner after every active member is notified'
);
select ok(
  not exists(select 1 from public.workspaces)
  and not exists(select 1 from public.workspace_memberships)
  and not exists(select 1 from public.invitations)
  and not exists(select 1 from public.accounts)
  and not exists(select 1 from public.plaid_items)
  and not exists(select 1 from public.transactions)
  and not exists(select 1 from public.transaction_metadata)
  and not exists(select 1 from public.manual_entries)
  and not exists(select 1 from public.budgets)
  and not exists(select 1 from public.categories)
  and not exists(select 1 from public.merchant_rules)
  and not exists(select 1 from public.sync_state)
  and not exists(select 1 from public.recent_auth_confirmations)
  and not exists(select 1 from public.audit_events)
  and not exists(select 1 from public.workspace_deletion_notifications),
  'GH-12 DB-002 finalization removes the complete graph including the retry-only notification ledger'
);
select ok(
  (select count(*) from public.auth_deletion_queue where auth_user_id in (
    'b3000000-0000-0000-0000-000000000001',
    'b3000000-0000-0000-0000-000000000002',
    'b3000000-0000-0000-0000-000000000003',
    'b3000000-0000-0000-0000-000000000004'
  )) = 4,
  'GH-12 DB-002 durable Auth deletion requests survive for every current or inactive member identity'
);
select ok(
  not exists(select 1 from public.profiles where id in (
    'b3000000-0000-0000-0000-000000000001',
    'b3000000-0000-0000-0000-000000000002',
    'b3000000-0000-0000-0000-000000000003',
    'b3000000-0000-0000-0000-000000000004'
  )),
  'GH-12 DB-003 active members and their Personal records are removed instead of blocking whole-workspace deletion'
);

-- GH-12 DB-004: retry is idempotent and does not duplicate durable side effects.
set local role service_role;
select lives_ok(
  $$select public.finalize_workspace_deletion(
    'b3000000-0000-0000-0000-000000000002',
    'GH-3 Household',
    true
  )$$,
  'GH-12 DB-004 trusted retry after committed finalization is an idempotent success'
);
select is(
  (select count(*) from public.auth_deletion_queue where auth_user_id in (
    'b3000000-0000-0000-0000-000000000001',
    'b3000000-0000-0000-0000-000000000002',
    'b3000000-0000-0000-0000-000000000003',
    'b3000000-0000-0000-0000-000000000004'
  )),
  4::bigint,
  'GH-12 DB-004 retry creates no duplicate Auth deletion requests'
);
select ok(
  not has_function_privilege('anon', 'public.finalize_account_deletion()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.finalize_workspace_deletion(uuid,text,boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.finalize_workspace_deletion(uuid,text,boolean)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.finalize_workspace_deletion(uuid,text,boolean)', 'EXECUTE')
  and not exists(
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = 'public.finalize_workspace_deletion(uuid,text,boolean)'::regprocedure
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  )
  and (select prosecdef and coalesce(array_to_string(proconfig, ','), '') ~ 'search_path=' from pg_proc where oid = 'public.finalize_account_deletion()'::regprocedure)
  and (select prosecdef and coalesce(array_to_string(proconfig, ','), '') ~ 'search_path=' from pg_proc where oid = 'public.finalize_workspace_deletion(uuid,text,boolean)'::regprocedure),
  'GH-12 workspace finalization is service-role-only, PUBLIC-denied, and hardened with a fixed search path'
);
select * from finish();
rollback;
