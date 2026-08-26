# GH-65 Complete Cursor Pagination - Acceptance Criteria

## Description (client-readable)

Household members can traverse every transaction matching the current Transactions filters without losing complete accounting totals or CSV behavior. Mobile starts with 10 visible rows, desktop starts with up to 50, and one explicit control progressively reveals buffered rows or obtains the next stable server page.

## Interface Contract

### API Endpoint

| Method | Path             | Query                                                                         | Response (success)                                                                                                                  | Response (error)                                                                             |
| ------ | ---------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| GET    | `/api/dashboard` | Existing strict dashboard query plus optional `cursor`; `limit` remains 1-100 | `200 DashboardReadModel` with complete `summary`, `totalTransactionCount`, stable `transactions`, and opaque `nextCursor` or `null` | Existing auth errors; `400 { error: "Invalid request.", fields }` for malformed query/cursor |

CSV remains on `GET /api/transactions/export` with its current query and complete-set semantics. Cursor and progressive feed depth are never accepted by or added to the export URL.

### Data Models

```ts
type DashboardReadModel = {
  // existing fields unchanged
  transactions: DashboardTransaction[];
  totalTransactionCount: number;
  nextCursor: string | null;
};

type DashboardCursorPayload = {
  version: 1;
  date: string; // YYYY-MM-DD
  source: "manual" | "plaid";
  id: string;
};
```

The cursor is an opaque base64url token. Clients may retain and return it but must not inspect it. The service sorts filtered display rows newest-first by `date DESC`, then `source ASC`, then `id ASC`; the cursor identifies that complete deterministic boundary. Invalid or unsupported cursor payloads produce a 400 rather than silently restarting at page one.

### Business Rules

1. Complete summary totals, trends, categories, filter options, and CSV output retain their current semantics and are independent of the visible page.
2. `totalTransactionCount` counts the complete result after every result-affecting filter, including inclusion, and before cursor/limit slicing.
3. A page contains at most `limit` rows. `nextCursor` is non-null only when at least one later matching row exists.
4. Equal-date rows across Plaid and Manual sources traverse exactly once in deterministic date/source/id order, with no duplicate or omission between pages.
5. The server-rendered `/transactions` payload requests up to 50 rows. Mobile reveals at most 10 initially; desktop reveals up to 50 initially. Each activation reveals 10 additional rows.
6. If another 10 rows are already buffered, activation performs no request. When the buffer is exhausted, activation requests the next server cursor page and reveals up to 10 newly available rows.
7. The UI states `visible of total transactions`. Progressive depth is client-only and is never written to the URL.
8. Changing scope, period, reference, custom dates, search, account, category, status, or inclusion replaces the buffer with the new first page, clears the cursor/retry state, and restores the responsive initial visible window.
9. Filter refresh and continuation requests are request-current. A response belonging to an older filter/cursor cannot overwrite or append to the newer query.
10. Navigating to plain `/transactions` reconciles the preserved client surface to URL defaults, including clearing narrowing filters and pagination state.
11. A continuation failure retains all loaded rows and their DOM order, does not force scroll movement, and shows compact retry feedback beside the expansion control. Retrying uses the same cursor and can recover.
12. Scope/privacy authorization and all existing filter, accounting, and export boundaries remain unchanged.

### UI Component Contract

`TransactionExplorer` keeps its existing props and frozen test IDs. Add:

| Test id                          | Element / meaning                                                    |
| -------------------------------- | -------------------------------------------------------------------- |
| `transactions-visible-count`     | Text containing `visible of total transactions`                      |
| `transactions-show-more`         | Primary progressive-reveal button, labelled `Show 10 more`           |
| `transactions-pagination-status` | Empty-mounted polite status region for continuation activity/success |
| `transactions-pagination-error`  | Compact continuation error beside the control                        |
| `transactions-pagination-retry`  | Retry button shown only after continuation failure                   |

The new controls use the existing Piggy utility/display typography, theme variables, rounded mineral/brand controls, 44 px minimum targets, focus styles, and reduced-motion conventions. No new visual language or dependency is introduced.

## API / Service Acceptance Tests

| ID      | Scenario                                               | Expected Result                                                                            |
| ------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| API-001 | Request the first page of more than 50 filtered rows   | Complete summary/count returned, first stable page returned, `nextCursor` non-null         |
| API-002 | Continue until cursor exhaustion                       | Every matching row appears exactly once and final `nextCursor` is null                     |
| API-003 | Equal-date Plaid and Manual rows span page boundaries  | Deterministic date/source/id order has no duplicates or omissions                          |
| API-004 | Apply each result-affecting filter                     | Count/page/cursor reflect that filtered query; complete totals preserve existing semantics |
| API-005 | Submit malformed or unsupported cursor                 | 400 invalid-request response with cursor field detail                                      |
| API-006 | Request `unlimited` service output for CSV             | All rows remain available and cursor pagination does not change export semantics           |
| API-007 | Request a cursor after underlying boundary-row removal | Lexicographic boundary continues safely rather than restarting or duplicating              |

## Frontend Acceptance Tests

| ID     | User Action                                                      | Expected Result                                                                             |
| ------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| FE-001 | Open Transactions at a mobile viewport with more than 50 matches | 10 rows and accurate visible-of-total text appear; control is a named 44 px target          |
| FE-002 | Activate Show 10 more while rows remain buffered                 | Exactly 10 more appear without a network request                                            |
| FE-003 | Exhaust the initial buffer and activate again                    | Next cursor page is fetched once and the next 10 rows append without duplicates             |
| FE-004 | Open at desktop width                                            | Up to 50 rows appear initially, with complete totals unchanged                              |
| FE-005 | Change every result-affecting filter after expansion             | Old pages/cursor/retry state clear and the responsive initial window is restored            |
| FE-006 | Resolve an older filter or cursor response after a newer query   | Older response cannot overwrite or append to the current view                               |
| FE-007 | Navigate from a filtered/expanded view to plain `/transactions`  | Default URL filters, first-page buffer, and initial visible depth are restored              |
| FE-008 | Fail the next-page request, then retry                           | Loaded rows/order remain, compact error and retry appear, retry recovers with no duplicates |
| FE-009 | Expand repeatedly                                                | Feed depth never appears in the URL and CSV still targets the complete applied filter query |

## Test Status

- [x] API-001: PASS
- [x] API-002: PASS
- [x] API-003: PASS
- [x] API-004: PASS
- [x] API-005: PASS
- [x] API-006: PASS
- [x] API-007: PASS
- [x] FE-001: PASS (component; real-browser dataset unavailable)
- [x] FE-002: PASS (component; real-browser dataset unavailable)
- [x] FE-003: PASS (component; real-browser dataset unavailable)
- [x] FE-004: PASS (component/page; real-browser dataset unavailable)
- [x] FE-005: PASS (component; real-browser dataset unavailable)
- [x] FE-006: PASS
- [x] FE-007: PASS (component; real-browser fixture-gated)
- [x] FE-008: PASS
- [x] FE-009: PASS (component; real-browser dataset unavailable)
