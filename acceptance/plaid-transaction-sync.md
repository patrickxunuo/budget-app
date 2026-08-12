# Plaid Transaction Synchronization - Acceptance Criteria

## Description (client-readable)

Budget App keeps linked-account transactions current in Supabase without calling Plaid on page loads. Signed Plaid webhooks initiate incremental synchronization, a secured nightly job recovers missed work, and members can check their own linked Item for already-available updates while seeing database-backed freshness and repair state.

## Interface Contract

This is the shared agreement between the Test Writer and the Implementer. The implementation must use Plaid `/transactions/sync`; `/transactions/refresh` is forbidden.

### API Endpoints

| Method | Path                       | Request                                             | Success                                                                | Error                                                                                                                                                                       |
| ------ | -------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/plaid/webhook`       | Raw Plaid JSON plus `Plaid-Verification` JWT header | `200 { accepted: true }` for valid recognized or safely ignored events | `401 { code: "invalid_webhook", message }` for missing/invalid/stale/body-mismatched signatures; `400 { code: "invalid_webhook_payload", message }` for invalid JSON/schema |
| `POST` | `/api/plaid/sync`          | Authenticated JSON `{ itemId: uuid }`               | `200 SyncResult` after checking already-available updates              | `400 invalid_request`; `401 unauthorized`; `403 forbidden`; `409 sync_in_progress`; sanitized `502 sync_failed`                                                             |
| `GET`  | `/api/plaid/status`        | Authenticated member session                        | `200 { items: SyncStatus[] }`, read only from Supabase                 | `401 unauthorized`; `403 inactive_membership`                                                                                                                               |
| `GET`  | `/api/internal/plaid-sync` | `Authorization: Bearer <CRON_SECRET>`               | `200 { attempted, succeeded, skipped, failed }`                        | `401 { code: "unauthorized" }`                                                                                                                                              |

### Data Models

`ProviderTransaction` adds `pendingTransactionId: string | null`. A complete sync pass contains `added`, `modified`, `removedIds`, `nextCursor`, and provider `requestId` values.

`SyncResult` is `{ itemId, status: "succeeded" | "idle", added, modified, removed, requestId, lastSuccessAt }`. It never contains an access token, encrypted token, raw payload, webhook credential, or provider error body.

`SyncStatus` is `{ itemId, institutionName, status: "idle" | "running" | "succeeded" | "failed", lastAttemptAt, lastSuccessAt, nextRetryAt, errorCode, needsLoginRepair, consentExpiresAt }`, with nullable timestamps/error code and no secret-bearing fields.

`sync_state` persists a cursor, current request ID/trigger, attempt/success/failure timestamps, next retry time, consecutive failure count, sanitized error code/message, login-repair flag, and consent-expiration timestamp. Transactions support removal without counting removed rows.

Implementation-facing exports are `syncPlaidItem`, `verifyPlaidWebhook`, `getPlaidSyncStatuses`, and `markPlaidItemAttention` from the server-only sync module, plus the client component `PlaidSyncStatus`. The route modules are exactly the four App Router paths listed above.

### Business Rules

1. Claim an Item atomically before Plaid calls. A non-stale active claim returns `sync_in_progress`; stale claims are recoverable.
2. Read the original stored cursor, collect every `/transactions/sync` page in memory, and persist no transaction or cursor changes until `hasMore` is false.
3. Commit the full collected pass in one database RPC under an Item row lock. The RPC checks the request ID and original cursor, applies added/modified/removed changes idempotently, and persists only the final cursor.
4. On `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`, discard all collected pages and restart from the original cursor. Never retry only the failed page.
5. Added and modified transactions are upserted. Removed transactions no longer count. A posted transaction referencing `pendingTransactionId` replaces the pending predecessor without double counting.
6. Only transactions for activated accounts belonging to the claimed Item are accepted. Unknown account IDs or cross-workspace/cross-owner Item IDs fail closed.
7. Verify `Plaid-Verification` as ES256 using Plaid's verification-key endpoint, reject expired keys, require `iat` within five minutes, and constant-time compare the SHA-256 of the exact raw request body.
8. Only `TRANSACTIONS/SYNC_UPDATES_AVAILABLE` starts sync. Valid irrelevant/unknown-Item webhooks are acknowledged without disclosing Item existence. Item error/consent events update sanitized database repair state.
9. Provider connection failures are retryable with bounded exponential backoff state. Login-required and consent-expiration signals are visible as repair state; raw Plaid errors are never stored or returned.
10. The nightly job is bearer-protected and attempts eligible active Items. The member endpoint authorizes both active workspace membership and ownership of the linked Item.
11. The member control calls `/transactions/sync` only. No page load calls Plaid, no hourly polling is added, and `/transactions/refresh` is never used.
12. Logs may contain request IDs, internal Item UUIDs, and sanitized error codes only; never secrets, access tokens, raw webhook credentials, or full financial payloads.

### UI Components

The Accounts page keeps the existing warm editorial ledger aesthetic and adds a compact “Data freshness” area per linked Item.

- `data-testid="plaid-sync-status"`: database-backed status/freshness summary.
- `data-testid="plaid-sync-check"`: member-triggered “Check for updates” button; disabled while checking.
- `data-testid="plaid-sync-feedback"`: polite live region for success/failure feedback.
- Login repair or expiring consent uses actionable, non-alarmist copy and does not expose provider error details.
- Keyboard focus, reduced motion, desktop/mobile layouts, and existing CSS variables remain supported.

## API Acceptance Tests

| ID      | Scenario                                                                   | Expected result                                                                            |
| ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| API-001 | Multi-page initial sync                                                    | All pages commit atomically and only the final cursor persists.                            |
| API-002 | Added, modified, removed, and pending-to-posted changes replayed twice     | Database result is identical after retry and has no double count.                          |
| API-003 | Mutation-during-pagination on a later page                                 | Partial pages are discarded and pagination restarts at the original cursor.                |
| API-004 | Two claims for one Item                                                    | First claim runs; second receives conflict; a stale claim can be recovered.                |
| API-005 | Foreign Item/account IDs                                                   | Processing fails closed with no transaction changes.                                       |
| API-006 | Valid `SYNC_UPDATES_AVAILABLE` webhook                                     | Signature/body are verified, owned Item is located, and sync starts.                       |
| API-007 | Missing, invalid, stale, expired-key, or body-mismatched webhook signature | Request is rejected without invoking sync.                                                 |
| API-008 | Valid irrelevant or unknown-Item webhook                                   | Request is acknowledged without revealing Item existence or syncing.                       |
| API-009 | Item login error and consent-expiration webhook                            | Sanitized repair/consent state is persisted and returned by status.                        |
| API-010 | Member sync/status authorization                                           | Active Item owner succeeds; anonymous, inactive, and foreign members fail.                 |
| API-011 | Nightly endpoint authorization and recovery                                | Wrong bearer fails; valid bearer attempts eligible Items and reports sanitized counts.     |
| API-012 | Provider/database failure                                                  | Retry state, timestamps, request ID, and sanitized error are stored; secrets never appear. |
| API-013 | Source/static guard                                                        | No implementation path calls `/transactions/refresh` or logs secret-bearing objects.       |

## Frontend Acceptance Tests

| ID     | User action                                     | Expected result                                                                                               |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| FE-001 | Member opens Accounts                           | Freshness and current repair state render from database data without a Plaid request.                         |
| FE-002 | Member selects “Check for updates”              | Button enters busy state, calls the member sync endpoint, and announces refreshed success state.              |
| FE-003 | Sync fails or login repair is required          | Accessible actionable feedback appears without provider internals; existing account-link flow remains usable. |
| FE-004 | Member uses mobile, keyboard, or reduced motion | Freshness controls remain readable, operable, and visually consistent.                                        |

## Test Status

- [x] API-001 through API-013: PASS (Vitest + 246-assertion pgTAP suite)
- [x] FE-001 through FE-004: PASS at component level; real-backend desktop/mobile Playwright is authored and fixture-gated
