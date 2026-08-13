# Plaid Connection Management - Acceptance Criteria

## Description (client-readable)

Members can inspect and safely manage the bank connections they personally linked. They can change account visibility, repair consent and account selection through Plaid, or disconnect while either retaining read-only history or deleting local data, with clear explanations of Item-wide and historical privacy effects.

## Interface Contract

This is the shared agreement between the Test Writer and Implementer. The server remains authoritative for membership, linker ownership, recent-password confirmation, account identity, and all lifecycle state.

### API Endpoints

| Method | Path                                           | Request Body                                                                               | Response (success)                                                                        | Response (error)                        |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------- |
| GET    | `/api/plaid/connections`                       | —                                                                                          | `200 { connections: PlaidConnection[] }`                                                  | `401/403 { code, message }`             |
| PATCH  | `/api/plaid/connections/[itemId]/visibility`   | `{ accountId: string, scope: "personal" \| "family", acknowledgeRetroactiveImpact: true }` | `200 { connection: PlaidConnection, recalculation: { dashboards: true, budgets: true } }` | `400/403/404/409 { code, message }`     |
| POST   | `/api/plaid/connections/[itemId]/update-token` | `{ reason: "login_repair" \| "consent" \| "permissions" \| "account_selection" }`          | `200 { linkToken, expiration, affectedAccountIds }`                                       | `400/403/404/409/502 { code, message }` |
| POST   | `/api/plaid/connections/[itemId]/reconcile`    | `{ deleteDeselectedAccountIds?: string[] }`                                                | `200 { connection, addedAccountIds, returnedAccountIds, deselectedAccounts }`             | `400/403/404/409/502 { code, message }` |
| POST   | `/api/plaid/connections/[itemId]/disconnect`   | `{ mode: "keep_history" \| "delete_data" }`                                                | `200 { itemId, mode, disconnected: true }`                                                | `400/403/404/409/502 { code, message }` |

Dynamic route handlers await `RouteContext<...>.params` as required by Next.js 16.3. GET management data is request-time and not cached.

### Data Models

`PlaidConnection` contains:

- `itemId`, `institutionName`, `linkedBy`, `isLinker`, `status`, `health`, `lastSyncAt`, `consentExpiresAt`, `disconnectedAt`.
- `itemImpact`: `{ accountCount, liveAccountCount, message }`.
- `accounts: ManagedPlaidAccount[]`.

`ManagedPlaidAccount` contains:

- `accountId`, `providerAccountId`, `displayName`, `mask`, `kind`, `scope`, `ownerProfileId`, `ownerDisplayName`.
- `availableBalanceCents`, `currentBalanceCents`, `balanceUpdatedAt`, `lastSyncAt`.
- `lifecycle: "live" \| "deselected" \| "disconnected"`, `readOnly`, `archivedAt`.

Only the linker receives controls. Other active members may receive Family account rows through existing scoped read paths, but this management endpoint lists only Items linked by the requesting member.

### Business Rules

1. Only an active member whose profile equals `plaid_items.linked_by` may list or mutate that Item through this module; Family owners have no override.
2. Visibility changes require an explicit retroactive-impact acknowledgement. Personal means `owner_profile_id = linked_by`; Family means `owner_profile_id is null`.
3. Every transition to or from Family emits an audit event with old/new scope, actor, account, Item, and timestamp. Dependent transaction metadata is updated atomically so dashboards and budgets recalculate from the new scope.
4. Visibility copy states that recalculation is retroactive and cannot undo prior viewing or export.
5. Update mode passes the encrypted Item access token to Plaid, supports login repair, consent, permission repair, and account-selection changes, and reports every local account sharing the Item.
6. Reconciliation calls the provider for a fresh account set. It matches by current provider account identity, restores returned accounts, creates newly selected eligible CAD chequing/savings/credit accounts, and never substitutes stale IDs.
7. Accounts absent from the fresh set become `deselected` and read-only. The response offers deletion; explicit IDs delete only data belonging to those deselected accounts.
8. Complete disconnect requires a valid recent-password confirmation window. The service calls Plaid `/item/remove` before final local transition and is idempotent for an already disconnected Item.
9. `keep_history` retains accounts/transactions, marks them read-only and disconnected, clears provider access material, and excludes the Item from future sync. `delete_data` removes the Item's local accounts, transactions, metadata, sync state, and token material.
10. Every Item-level action explains when multiple accounts are affected.
11. On member departure/removal, revoke every Item linked by that member; preserve already-shared Family transaction history as disconnected read-only records while deleting Personal account history. Provider revocation is attempted through the service boundary before the membership mutation completes; failures do not silently leave a live Item.
12. Client responses and logs never expose access tokens, raw Plaid errors, or secret-bearing payloads.

### UI Components

`PlaidConnectionManager` receives `initialConnections: PlaidConnection[]` and renders the existing editorial financial-dossier aesthetic using project CSS variables and typography.

Required test IDs:

- `plaid-connections`, `plaid-connection-[itemId]`, `plaid-health-[itemId]`, `plaid-item-impact-[itemId]`
- `plaid-account-[accountId]`, `plaid-visibility-[accountId]`, `plaid-visibility-warning-[accountId]`
- `plaid-update-[itemId]`, `plaid-reconcile-[itemId]`, `plaid-deselected-[accountId]`, `plaid-delete-deselected-[accountId]`
- `plaid-disconnect-[itemId]`, `plaid-disconnect-mode-[itemId]`, `plaid-disconnect-confirm-[itemId]`, `plaid-operation-status`

The interface is responsive, keyboard operable, focus-visible, reduced-motion safe, and uses text/shape in addition to color for health and destructive states.

## API Acceptance Tests

| ID      | Scenario                                                               | Precondition                                | Request                                     | Expected Response                                                                          |
| ------- | ---------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| API-001 | Linker lists complete management dossier                               | Active linker with Item/accounts/sync state | GET connections                             | 200 with masked identities, balances, owner, visibility, freshness, health and Item impact |
| API-002 | Non-linker cannot manage another member's Item                         | Active workspace owner but different linker | Any Item mutation                           | 403 without mutation                                                                       |
| API-003 | Visibility acknowledgement required                                    | Linker                                      | PATCH with false/missing acknowledgement    | 400, no scope/audit changes                                                                |
| API-004 | Personal-to-Family transition is atomic and audited                    | Linker, Personal account                    | PATCH Family                                | 200; owner cleared, metadata recalculated, Family audit event written                      |
| API-005 | Family-to-Personal transition is atomic and audited                    | Linker, Family account                      | PATCH Personal                              | 200; owner becomes linker, metadata recalculated, audit event written                      |
| API-006 | Update token carries Item-level context                                | Linker, active or repairable Item           | POST update-token for each supported reason | 200 token plus all affected account IDs; provider gets Item access token                   |
| API-007 | Fresh reconciliation handles returned/new/deselected accounts          | Provider set differs from local set         | POST reconcile                              | 200 with correct deltas; stale IDs are not reused                                          |
| API-008 | Explicit deselected deletion is scoped                                 | Deselected accounts across Items            | POST reconcile with delete IDs              | Only validated deselected accounts on the target Item are deleted                          |
| API-009 | Disconnect requires recent confirmation                                | Linker without confirmation                 | POST disconnect                             | 403 `recent_confirmation_required`; provider/local state unchanged                         |
| API-010 | Keep-history disconnect removes provider access                        | Recently confirmed linker                   | POST keep_history                           | Provider remove called once; retained rows read-only/disconnected and sync disabled        |
| API-011 | Delete-data disconnect removes only target Item data                   | Recently confirmed linker                   | POST delete_data                            | Provider remove called once; target Item local graph deleted                               |
| API-012 | Member departure preserves Family history and removes Personal history | Departing member with mixed scopes          | leave/remove workflow                       | Item revoked; Family rows retained read-only, Personal rows removed                        |
| API-013 | Provider and database failures are sanitized                           | Provider/RPC failure                        | Any mutation                                | Stable error code/message; no secret/raw payload exposure                                  |
| API-014 | Repeat disconnect is idempotent                                        | Already disconnected Item                   | Same POST disconnect                        | 200 disconnected result; no second provider removal                                        |

## Frontend Acceptance Tests

| ID     | User Action                                         | Expected Result                                                                                                                |
| ------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| FE-001 | Open Accounts as a linker                           | Institution/account dossier shows ownership, masks, balances, visibility, last sync, health, and multi-account impact          |
| FE-002 | Change visibility                                   | Warning explains retroactive recalculation and irreversible prior viewing/export; confirmed mutation refreshes the dossier     |
| FE-003 | Repair/select accounts through update mode          | Plaid opens for the chosen reason; reconciliation reports returned/new/deselected accounts and offers deselected-data deletion |
| FE-004 | Choose a disconnect mode                            | Keep/delete consequences and Item-wide impact are distinct; confirmation is explicit and status is announced                   |
| FE-005 | Use management UI on mobile/keyboard/reduced motion | Controls remain usable, focus-visible, readable, and non-color-dependent                                                       |

## Test Status

- [x] API-001: PASS
- [x] API-002: PASS
- [x] API-003: PASS
- [x] API-004: PASS
- [x] API-005: PASS
- [x] API-006: PASS
- [x] API-007: PASS
- [x] API-008: PASS
- [x] API-009: PASS
- [x] API-010: PASS
- [x] API-011: PASS
- [x] API-012: PASS
- [x] API-013: PASS
- [x] API-014: PASS
- [x] FE-001: PASS (component; real-backend browser journey fixture-gated)
- [x] FE-002: PASS (component; real-backend browser journey fixture-gated)
- [x] FE-003: PASS (component; real-backend browser journey fixture-gated)
- [x] FE-004: PASS (component; destructive real-backend browser journey fixture-gated)
- [x] FE-005: PASS (component; real-backend browser journey fixture-gated)
