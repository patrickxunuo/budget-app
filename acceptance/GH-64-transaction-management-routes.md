# GH-64 Transaction Management Routes - Acceptance Criteria

## Description (client-readable)

Transactions becomes a focused, read-only overview on every screen size. Manual/Cash and Plaid management keep their existing behavior on dedicated pages reached through a compact Manage menu, with the active privacy scope and safe return path preserved.

## Interface Contract

This is the shared agreement between the Test Writer and the Implementer. The change moves existing workflows without changing their mutation or CSV APIs.

### Routes and Existing API Endpoints

| Method                | Path                                                                  | Contract                                                                          |
| --------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| GET                   | `/transactions?[filters]`                                             | Read-only explorer; loads only the existing filter-faithful dashboard read model. |
| GET                   | `/transactions/manual?scope=family\|personal&returnTo=<encoded path>` | Manual/Cash creation, edit, register, deletion confirmation, and desktop export.  |
| GET                   | `/transactions/plaid?scope=family\|personal&returnTo=<encoded path>`  | Plaid one-off category and merchant-rule management.                              |
| GET/POST/PATCH/DELETE | Existing `/api/manual-entries/**`                                     | Unchanged request, response, authorization, and CSV semantics.                    |
| GET/PATCH/POST        | Existing `/api/transactions/**` and category/rule routes              | Unchanged request, response, authorization, and CSV semantics.                    |

### Data Models

- `Scope` is exactly `"family" | "personal"`; invalid or repeated values resolve through the existing explorer filter parser.
- `returnTo` is an optional encoded relative URL. A valid target has pathname exactly `/transactions`, may carry the existing overview query string, and cannot contain credentials, a host, a protocol-relative prefix, or a different path. Invalid input resolves to `/transactions?scope=<validated scope>`.
- Overview filters remain the existing `ExplorerFilters`; their canonical query comes from `toExplorerSearchParams`.

### Business Rules

1. `/transactions` renders `TransactionExplorer` and no Manual/Cash or editable Plaid workbench.
2. The overview must not call `getManualEntryContext`, `listManualEntries`, `listTransactions`, or `listCategoriesAndRules`; it loads only the existing overview read model and its authorization context.
3. `/transactions/manual` independently establishes authenticated membership context, loads scoped Manual/Cash rows plus all active categories available to the member, and renders the existing `ManualEntryWorkbench` without narrowing its existing entry-scope choices.
4. `/transactions/plaid` independently establishes authenticated membership context, loads scoped Plaid rows plus categories/rules, and renders the existing `TransactionLedger`.
5. A compact, low-emphasis Manage menu on the overview links to both management routes. Both links carry the validated active scope and the canonical filtered overview as `returnTo`.
6. Each management route renders a `Back to Transactions` link resolved from the safe `returnTo`; ordinary browser Back remains functional.
7. Invalid, external, protocol-relative, credential-bearing, or non-`/transactions` return targets fall back to the validated scoped overview.
8. The overview contains no creation, categorization, rule, edit, delete, or other financial mutation control.
9. Filtered overview CSV remains in its compact toolbar and Manual CSV remains on the Manual route, but both controls use `display: none` below the Tailwind `md` breakpoint (768px), keeping them out of layout, keyboard order, and the accessibility tree.
10. Existing mutation endpoints, client calls, pending states, CSV serialization, and financial semantics remain unchanged.

### UI Components

| Component/surface               | Required contract                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `TransactionManagementMenu`     | `data-testid="transactions-manage-menu"`; links `transactions-manage-manual` and `transactions-manage-plaid`. |
| `TransactionManagementBackLink` | `data-testid="back-to-transactions"`; accessible name `Back to Transactions`.                                 |
| Overview                        | Existing `transactions-explorer`; does not contain `manual-entry-workbench` or `transaction-ledger`.          |
| Manual route                    | `data-testid="manual-management-page"`; contains existing `manual-entry-workbench`.                           |
| Plaid route                     | `data-testid="plaid-management-page"`; contains existing `transaction-ledger`.                                |
| Export controls                 | Existing `transactions-export-csv` and `manual-entry-export`; hidden below `md`, visible at and above `md`.   |

## API and Route Acceptance Tests

| ID      | Scenario                                                                                                    | Expected Result                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| API-001 | Render overview with a valid scope and filters                                                              | Only the dashboard/context read boundary is called; no management dataset is fetched.                   |
| API-002 | Render Manual route for Family and Personal scopes                                                          | The route independently authorizes and requests only matching Manual rows and active categories.        |
| API-003 | Render Plaid route for Family and Personal scopes                                                           | The route independently authorizes and requests only matching Plaid rows and category/rule context.     |
| API-004 | Resolve valid, invalid, external, protocol-relative, credential-bearing, and non-transaction return targets | Only a relative `/transactions` target survives; every unsafe target falls back to the scoped overview. |
| API-005 | Exercise existing mutation and CSV clients after the move                                                   | Request paths/payloads and CSV output semantics remain unchanged.                                       |

## Frontend Acceptance Tests

| ID     | User Action                                                                      | Expected Result                                                                                                               |
| ------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| FE-001 | Open `/transactions` on desktop or mobile                                        | Read-only explorer is present; Manual and Plaid mutation workbenches are absent.                                              |
| FE-002 | Open Manage from a filtered Family/Personal overview and choose each destination | Both links preserve scope and a safe canonical return target.                                                                 |
| FE-003 | Use Back to Transactions from either management page                             | The prior filtered overview URL is restored when safe; malformed/external targets fall back safely.                           |
| FE-004 | Use Manual/Cash workflows on the Manual route                                    | Existing create/edit/delete/register behavior remains available with independent scope enforcement.                           |
| FE-005 | Use categorization and merchant-rule workflows on the Plaid route                | Existing one-off category, source/effective context, preview, and rule creation remain available.                             |
| FE-006 | Inspect export controls below 768px and at desktop width                         | Controls are absent from layout, tab order, and accessibility tree below `md`, and available in the correct desktop toolbars. |
| FE-007 | Navigate Manage to subpage and then browser Back                                 | Browser history returns to the exact filtered overview without cross-scope data exposure.                                     |

## Test Status

- [x] API-001: PASS — route boundary test and full Vitest suite.
- [x] API-002: PASS — Family/Personal Manual route boundary tests.
- [x] API-003: PASS — Family/Personal Plaid route boundary tests.
- [x] API-004: PASS — safe-return unit matrix.
- [x] API-005: PASS — existing mutation/CSV tests remain green; no API implementation changed.
- [x] FE-001: PASS — route/component tests; browser case authored and fixture-gated locally.
- [x] FE-002: PASS — navigation component tests; browser case authored and fixture-gated locally.
- [x] FE-003: PASS — helper/navigation tests; browser case authored and fixture-gated locally.
- [x] FE-004: PASS — existing Manual component suite; real-backend browser case repointed and fixture-gated locally.
- [x] FE-005: PASS — existing Plaid ledger component suite; browser case authored and fixture-gated locally.
- [x] FE-006: PASS — responsive class assertions; browser computed-layout case authored and fixture-gated locally.
- [ ] FE-007: AUTHORED — browser-history coverage requires the `auth-owner` fixture and did not execute locally.
