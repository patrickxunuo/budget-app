# Supabase Family Privacy - Acceptance Criteria

## Description (client-readable)

Budget App stores one Canadian household's financial data in a versioned Supabase database. Active family members can collaborate on Family-scoped records, while Personal-scoped records remain visible and mutable only to their owner—even when another member is the family owner.

## Interface Contract

This is the shared agreement between the Test Writer and the Implementer. GH-2 adds database migrations and database tests only; it adds no HTTP endpoints or UI.

### Database entry points

| Entry point     | Contract                                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Migration       | `supabase/migrations/20260811180000_family_finance_schema.sql` replays from an empty Supabase database without manual SQL.             |
| Database tests  | `supabase test db` discovers pgTAP files under `supabase/tests/database/`.                                                             |
| Browser roles   | `anon` has no access to application tables. `authenticated` receives only explicitly granted operations and is always filtered by RLS. |
| Privileged role | `service_role` is server-only, bypasses RLS, and is used only for Plaid synchronization, invitation workflows, and audit writes.       |

### Data models

All application tables live in `public`, use UUID primary keys with `gen_random_uuid()`, use `timestamptz`, and have `created_at`; mutable tables also have an automatically maintained `updated_at`.

| Model                   | Required contract                                                                                                                                                                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles`              | `id` references `auth.users(id)`; display metadata; a user can read their own profile and active members can read profiles in their workspace.                                                                                                                                                            |
| `workspaces`            | Singleton family workspace (`singleton_key = true` unique); name and `owner_profile_id`; only an active owner administers it.                                                                                                                                                                             |
| `workspace_memberships` | Unique `(workspace_id, profile_id)`; role `owner/member`; status `invited/active/inactive`; exactly one owner membership per workspace through a partial unique index.                                                                                                                                    |
| `invitations`           | Workspace, normalized email, member role only, inviter, SHA-256-or-stronger token hash (never a raw token), expiry, accepted/revoked timestamps; active owners administer invitations.                                                                                                                    |
| `plaid_items`           | Workspace, `linked_by`, immutable provider `plaid_item_id` and institution identity, encrypted access-token ciphertext plus key version, status, archive timestamp. Authenticated users never select token ciphertext. Only the linker can see or manage the item through normal access.                  |
| `accounts`              | Workspace and Plaid Item, `linked_by`, immutable provider account id/type/subtype/currency/mask/name, user-owned `display_name`, `scope`, `owner_profile_id`, and archive timestamp. v1 permits only CAD `chequing`, `savings`, and `credit_card`; Personal requires owner = linker, Family has no owner. |
| `transactions`          | Immutable Plaid mirror keyed by provider transaction id, account/workspace, amount, CAD currency, dates, merchant/name, pending state, and provider payload. Browser roles may read but not mutate it.                                                                                                    |
| `transaction_metadata`  | One-to-one with transaction; user-owned scope/owner, category, note, and excluded flag. Family is collaborative; Personal is owner-only.                                                                                                                                                                  |
| `manual_entries`        | Workspace, creator, Family/Personal scope and matching owner semantics, amount, CAD currency, date, description, category, archive timestamp.                                                                                                                                                             |
| `categories`            | Workspace, creator, name/color, Family/Personal scope and matching owner semantics, archive timestamp; uniqueness is scoped to active records and the relevant owner.                                                                                                                                     |
| `merchant_rules`        | Workspace, creator, normalized merchant match, category, Family/Personal scope and matching owner semantics, priority/enabled, archive timestamp.                                                                                                                                                         |
| `budgets`               | Workspace, creator, category, positive amount in CAD, date range with end >= start, Family/Personal scope and matching owner semantics, archive timestamp.                                                                                                                                                |
| `sync_state`            | One row per Plaid Item with cursor, last attempt/success, status `idle/running/succeeded/failed`, and sanitized error code/message; only the linker can read it and browser roles cannot write it.                                                                                                        |
| `audit_events`          | Append-only workspace event with actor, action, target identifiers, scope/owner, and JSON details. Authenticated users may read visible events but cannot insert/update/delete; service role writes.                                                                                                      |

### Authorization helpers

- Authorization helpers live in a non-exposed `private` schema, are `security definer`, set an empty or fixed `search_path`, and are executable only by roles that need them.
- Helpers establish active membership, active owner role, Family visibility, and Personal ownership without recursively querying an RLS-protected table.
- RLS predicates use `(select auth.uid())`, specify `to authenticated`, and are backed by indexes on foreign keys and policy columns.

### Business Rules

1. Every scoped record belongs to the singleton workspace and has either `scope = 'family'` with `owner_profile_id is null`, or `scope = 'personal'` with `owner_profile_id` populated.
2. Family records are visible to every active workspace member. Personal records are visible only when `owner_profile_id = auth.uid()`; the workspace owner role grants no exception.
3. Inactive/invited/non-members and anonymous callers cannot read or mutate household data.
4. The account linker owns the Plaid connection. Other active members may view Family accounts but cannot view or manage Plaid Item identity or synchronization state.
5. Provider identity and transaction mirror fields are immutable to authenticated browser users. User metadata lives in mutable metadata columns/tables governed by scope RLS.
6. Plaid access tokens are stored only as ciphertext plus key version. `anon` and `authenticated` receive no column/table privilege that can reveal ciphertext; no migration embeds a key.
7. Application deletes use archive/inactive/revoked timestamps where historical records must remain. Audit events and Plaid transactions are never browser-deletable.
8. Foreign keys, uniqueness, check constraints, timestamps, and indexes reject invalid v1 currency/account/scope/state combinations and support RLS joins.
9. Privileged server access is documented as an explicit RLS bypass and remains confined to the existing `server-only` admin client.
10. Transaction metadata must remain in the same privacy domain as its underlying account, and account scope changes cannot strand metadata in a different domain. Shared metadata cannot be converted into Personal metadata.
11. Category references must match the referencing record's workspace, scope, and owner so Family rows never expose Personal-category identifiers.

## Database Acceptance Tests

| ID     | Scenario                                                                                                                        | Expected result                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| DB-001 | Replay the migration on a clean local Supabase database.                                                                        | All enums, tables, functions, triggers, constraints, grants, indexes, and policies are created.                                |
| DB-002 | Inspect every public application table.                                                                                         | RLS is enabled and `anon` has no table privileges.                                                                             |
| DB-003 | Insert invalid non-CAD, unsupported account type, inconsistent scope/owner, non-positive budget, and invalid date range values. | Each write is rejected by a named constraint.                                                                                  |
| DB-004 | Try to create a second workspace or second active owner membership.                                                             | Uniqueness rejects both.                                                                                                       |
| DB-005 | Read Family records as two active members.                                                                                      | Both members can read them; an inactive member and outsider cannot.                                                            |
| DB-006 | Read Personal records as their owner, a family member, and the workspace owner.                                                 | Only the record owner can read them.                                                                                           |
| DB-007 | Manage a Plaid Item/account as the linker and another active member.                                                            | The linker can manage allowed metadata; the other member cannot mutate provider/link state. Neither can read token ciphertext. |
| DB-008 | Mutate immutable Plaid transaction/provider fields as `authenticated`.                                                          | The write is denied; service-role setup can write synchronization data.                                                        |
| DB-009 | Create/update/delete Family and Personal categories, rules, budgets, manual entries, and transaction metadata.                  | Active members collaborate on Family rows; only owners operate on Personal rows.                                               |
| DB-010 | Write sync state or audit events as `authenticated`, then read audit events in Family/Personal scopes.                          | Writes are denied; reads follow Family/Personal visibility.                                                                    |
| DB-011 | Execute policies as anonymous, expired-session/no-UID, and inactive-member contexts.                                            | No protected rows are exposed.                                                                                                 |
| DB-012 | Inspect authorization helper definitions and grants.                                                                            | Helpers are outside `public`, use fixed search paths, and expose no general-purpose privileged data access.                    |

## Frontend Acceptance Tests

Not applicable. GH-2 has no user-facing route or interaction.

## Test Status

- [x] DB-001: PASS
- [x] DB-002: PASS
- [x] DB-003: PASS
- [x] DB-004: PASS
- [x] DB-005: PASS
- [x] DB-006: PASS
- [x] DB-007: PASS
- [x] DB-008: PASS
- [x] DB-009: PASS
- [x] DB-010: PASS
- [x] DB-011: PASS
- [x] DB-012: PASS
