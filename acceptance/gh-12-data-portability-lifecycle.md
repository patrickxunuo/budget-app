# GH-12 Data Portability and Lifecycle Controls - Acceptance Criteria

## Description (client-readable)

Household members can download the exact Family or Personal ledger view they are currently reviewing without exposing secrets or another member's private records. Account and workspace deletion become deliberate, retryable operations that revoke connected banks before removing local data and explain what an administrator must back up outside the app.

## Interface Contract

### API Endpoints

| Method | Path                       | Request              | Success                | Error |
| ------ | -------------------------- | -------------------- | ---------------------- | ----- |
| GET    | `/api/transactions/export` | Query: `scope=family | personal`, `period=day | week  | month | custom`, `reference=YYYY-MM-DD`, optional `from`, `to`, `accountId`, `categoryId`, `status=all | pending | posted`, `inclusion=default | included | excluded | transfers | all`, `search` | `200 text/csv; charset=utf-8`, attachment filename `budget-app-{scope}-{from}-to-{to}.csv` | `400/401/403/500` JSON `{ error, fields? }` |

The CSV starts with a UTF-8 BOM and has this exact header order:

`date,description,merchant,amount,kind,category,account,pending,notes,source,inclusion`

`amount` is a signed CAD decimal with exactly two fraction digits. `pending` is `true` or `false`; `source` is `plaid` or `manual`; `inclusion` is `included`, `transfer`, `excluded`, or `superseded` (superseded rows are normally filtered out by the shared read model).

### Server Action Inputs and Results

| Action            | Form fields                                                                       | Success                                                                                                                                                     | Recoverable failure                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `deleteAccount`   | `accountConfirmation` must equal `DELETE MY ACCOUNT`                              | Sign out and redirect to `/sign-in` after confirmed Plaid revocation, Personal cleanup, and Auth deletion/outbox processing                                 | `AuthActionState { status: "error", message, data?: { unresolvedPlaidItemIds: string[] } }`                          |
| `deleteWorkspace` | `workspaceName` exact trimmed name; `irreversibleAcknowledgement` must equal `on` | Notify members when SMTP is configured, revoke every Plaid Item, purge the workspace, queue all member Auth identities, clear cookies, redirect to `/setup` | Same recoverable error shape; retry resumes without discarding provider credentials or completed revocation progress |

### Data Models

- `CsvExportRow`: `{ date, description, merchant, amountCents, kind, category, account, pending, notes, source, inclusion }`; no IDs, tokens, provider payloads, owner IDs, authorization state, or secrets.
- `PlaidRevocationResult`: `{ confirmedItemIds: string[], unresolvedItemIds: string[] }`; unresolved IDs are internal UUIDs only and are safe to show to the authenticated actor.
- Optional server-only SMTP configuration: `SMTP_URL` and `SMTP_FROM` must either both be absent or both be valid. They are never exposed to the browser. Notification is attempted before workspace deletion; configured notification failure is recoverable and leaves data intact.

### Business Rules

1. Export reads every matching row with stable pagination before serialization; display limits never truncate the file.
2. Family scope contains Family records only. Personal scope contains only the signed-in member's Personal records. No Combined export exists.
3. All active dashboard filters are parsed by the same schema and applied before export.
4. CSV follows RFC 4180 quoting, preserves UTF-8, uses CRLF, and prefixes cells whose first non-whitespace character is `=`, `+`, `-`, `@`, tab, or carriage return with an apostrophe to prevent spreadsheet formula execution. Numeric `amount` is produced by trusted code and is not escaped as user text.
5. Account deletion requires recent password confirmation and the exact confirmation phrase. An owner must transfer ownership or delete the workspace instead.
6. Workspace deletion requires owner authorization, recent password confirmation, the exact workspace name, and the irreversible acknowledgement. Active members do not block whole-workspace deletion.
7. Provider revocation happens before destructive local deletion. An unconfirmed Plaid revocation leaves the Item and encrypted token retryable, prevents local purge, and returns a safe actionable error.
8. Confirmed revocations are idempotent. A retry does not recreate deleted data or require a second provider call for an already-confirmed Item.
9. Workspace finalization removes Family and Personal transactions/manual entries, budgets, categories, merchant rules, accounts, Plaid/sync state, memberships, invitations, recent confirmations, and audit events, while durable Auth identity deletion requests survive.
10. If SMTP is fully configured, all active member email addresses receive a warning before final deletion. If SMTP is absent, deletion proceeds without attempting mail. No recipient list or SMTP secret is returned to the client.
11. Successful workspace deletion returns the installation to first-owner setup. Full database backup/restore remains the Supabase administrator's responsibility and is documented in the danger zone and README.

### UI Components

- `FinancialDashboard` renders `data-testid="dashboard-export-csv"`. Its href is `/api/transactions/export` with the currently applied scope, period/range, account, category, status, inclusion, and search parameters. It remains keyboard accessible and is disabled/marked busy while a filter refresh is pending.
- `MembershipConsole` renders `data-testid="account-deletion-confirmation"`, `data-testid="delete-account"`, `data-testid="workspace-deletion-acknowledgement"`, and `data-testid="delete-workspace"`.
- Destructive controls explain provider revocation, retry behavior, member notification, irreversibility, and Supabase-admin backup/restore responsibility. Feedback uses the existing live region and never prints secret values.

## API Acceptance Tests

| ID      | Scenario                                                                     | Expected Result                                                                                                   |
| ------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| API-001 | Export a filtered Family ledger containing Plaid and Manual/Cash rows        | Complete matching CSV in exact column order; filters and stable sorting preserved                                 |
| API-002 | Export Personal scope as one member                                          | Only that member's Personal rows appear; other Personal and Family rows are absent                                |
| API-003 | Export cells containing commas, quotes, CR/LF, Unicode, and formula prefixes | RFC 4180/UTF-8 output round-trips and formula-like text is apostrophe-prefixed                                    |
| API-004 | Send invalid or unknown query parameters                                     | `400` JSON without a CSV body                                                                                     |
| API-005 | Request export without an active authenticated membership                    | `401` or `403` JSON and no records                                                                                |
| API-006 | Delete an account without recent password or exact phrase                    | Validation/authorization error; no provider or database mutation                                                  |
| API-007 | Account revocation is unconfirmed                                            | Error lists unresolved Item IDs; encrypted token and local data remain retryable                                  |
| API-008 | Retry account deletion after confirmed revocation                            | Provider/local cleanup is idempotent; Auth identity deletion completes or remains queued                          |
| API-009 | Non-owner or mismatched name/ack attempts workspace deletion                 | Error; no mail, provider, or database deletion occurs                                                             |
| API-010 | Owner deletes workspace with all revocations confirmed                       | All workspace/member data is purged, every Auth identity is queued, and setup is available                        |
| API-011 | A workspace revocation or configured notification fails                      | Error is actionable; local workspace stays intact and a retry can resume safely                                   |
| API-012 | SMTP is absent vs. fully configured                                          | Absent skips mail; configured sends one pre-deletion warning per active member without leaking recipients/secrets |

## Frontend Acceptance Tests

| ID | User Action | Expected Result |
| --- | --- |
| FE-001 | Change dashboard scope/date/search/account/category/status/inclusion and choose Export CSV | Download request contains the exact applied filter state and clear scoped filename |
| FE-002 | Type an incorrect account phrase or omit workspace acknowledgement/name | Destructive submit is blocked or returns field-level feedback; controls remain usable |
| FE-003 | Complete owner deletion confirmation on desktop/mobile | UI communicates irreversibility, Plaid-first retry semantics, notification behavior, and administrator backup boundary |
| FE-004 | Provider revocation cannot be confirmed | Live feedback reports a retryable failure without losing the form or exposing secrets |

## Database Acceptance Tests

| ID     | Scenario                                                             | Expected Result                                                                              |
| ------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| DB-001 | Authenticated caller bypasses confirmation/ownership guards          | RPC rejects and preserves all rows                                                           |
| DB-002 | Workspace finalization after confirmed revocations                   | Complete graph is removed and durable Auth deletion queue rows for every member remain       |
| DB-003 | Active members exist during owner-requested whole-workspace deletion | Members do not block finalization; their Personal/Family records and memberships are removed |
| DB-004 | Finalization is retried                                              | No duplicate side effects or constraint failures                                             |

## Test Status

- [x] API-001 through API-012: PASS (Vitest route/service coverage)
- [x] FE-001 through FE-004: PASS (component coverage; real-backend desktop/mobile Playwright authored and fixture-gated in this environment)
- [x] DB-001 through DB-004: PASS (400-assertion full pgTAP suite)
