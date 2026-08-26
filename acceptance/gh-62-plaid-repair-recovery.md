# GH-62 Plaid Repair Recovery - Acceptance Criteria

## Description

When a member repairs an institution sign-in, Piggy verifies transaction access before clearing the repair warning. A verified repair returns the Accounts status to Connected without replacing the existing Plaid Item, accounts, visibility choices, or transaction history.

## Interface Contract

### Existing API endpoints

| Method | Path                                          | Request                              | Success                                       | Failure                   |
| ------ | --------------------------------------------- | ------------------------------------ | --------------------------------------------- | ------------------------- |
| POST   | `/api/plaid/connections/:itemId/update-token` | `{ reason: "login_repair" }`         | `200 { linkToken }`                           | Sanitized Plaid API error |
| POST   | `/api/plaid/connections/:itemId/reconcile`    | `{ deleteDeselectedAccountIds: [] }` | `200` connection reconciliation result        | Sanitized Plaid API error |
| POST   | `/api/plaid/sync`                             | `{ itemId }`                         | `200 SyncResult` after atomic provider commit | Sanitized sync error      |

The client runs those calls in that order after Plaid Link success. It dispatches `plaid:sync-completed` with the successful `SyncResult` as `CustomEvent.detail` only after `/api/plaid/sync` succeeds.

### Business rules

1. `commit_plaid_sync` is the only repair-flow authority that clears `needs_login_repair` and prior login error fields.
2. Plaid Link success or account reconciliation alone cannot clear repair state.
3. Failed provider sync and cancelled Link preserve repair-required state.
4. Successful repair preserves the Plaid Item ID, account IDs and scopes, and existing transaction IDs/history.
5. The status card consumes only a successful event for the matching Item, changes Action needed to Connected, and re-enables Check for updates.

## Acceptance tests

- [x] DB-001: PASS — successful atomic commit clears repair and prior error state.
- [x] DB-002: PASS — failed sync keeps repair state sticky.
- [x] DB-003: PASS — successful empty verification preserves Item, account, visibility, and transaction identity/history.
- [x] FE-001: PASS — login repair calls update-token, reconcile, and sync in order, then notifies status.
- [x] FE-002: PASS — failed sync and cancelled Link do not notify success or clear repair messaging.
- [x] FE-003: PASS — matching successful sync notification changes Action needed to Connected and enables checks.
- [ ] E2E-001: Authored; local run fixture-gated because `plaid-repair` credentials were absent.
