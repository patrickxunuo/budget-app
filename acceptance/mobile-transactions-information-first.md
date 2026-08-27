# Mobile Transactions Information-First - Acceptance Criteria

## Description

The Transactions overview prioritizes scope, complete-set totals, and recent activity on mobile while keeping filtering compact. Dense grouped rows open a complete, read-only detail sheet; mutation workflows remain on their dedicated routes and desktop retains its review/export affordances.

## Interface Contract

### API Endpoint

| Method | Path                                   | Request                                         | Success                                  | Error                                                                                                             |
| ------ | -------------------------------------- | ----------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/transactions/detail/:source/:id` | `source` is `plaid` or `manual`; `id` is a UUID | `200 { transaction: TransactionDetail }` | `400 { error: "Invalid request." }`, `401/403` from membership auth, or `404 { error: "Transaction not found." }` |

`TransactionDetail` is source-aware and contains exactly the authorized row's available read-only metadata:

```ts
type TransactionDetail = {
  id: string;
  source: "plaid" | "manual";
  date: string;
  merchantOrDescription: string;
  description: string | null;
  amountCents: number;
  accountName: string | null;
  scope: "family" | "personal";
  state: "posted" | "pending";
  kind: "income" | "spending" | "transfer" | "refund";
  originalCategory: { primary: string; detailed: string } | null;
  effectiveCategory: string | null;
  excluded: boolean;
  notes: string | null;
};
```

The endpoint must query through the authenticated workspace/member context and database RLS. It must not accept a scope override or expose provider payloads, owner IDs, tokens, mutation controls, or records outside the caller's authorized rows.

### UI Components and Test IDs

- `TransactionExplorer` remains the filter, URL, retained-refresh, complete-summary, and cursor-pagination controller.
- `TransactionFilterSheet` owns mobile-only advanced filters and custom dates. Trigger: `transactions-filters-trigger`; dialog: `transactions-filter-sheet`; close: `transactions-filter-close`; active count text: `transactions-filter-count`.
- Desktop advanced fields retain `transactions-account-filter`, `transactions-category-filter`, `transactions-status-filter`, and `transactions-inclusion-filter`.
- Applied chips live in `transactions-filter-chips`; each remove button is `transactions-filter-chip-{field}` and resets pagination while updating the URL through the existing controller.
- `TransactionFeed` renders `transactions-result-list`, date headings `transactions-date-group-{yyyy-mm-dd}`, and row buttons `transactions-result-{id}` in one bordered ledger.
- `TransactionDetailSheet` renders dialog `transaction-detail-sheet`, close `transaction-detail-close`, loading `transaction-detail-loading`, error `transaction-detail-error`, retry `transaction-detail-retry`, and metadata definition list `transaction-detail-metadata`.
- Existing scope, period, search, summary, show-more, pagination status, management, and desktop export IDs remain stable.

### Business Rules

1. Below 768px the order is: Transactions heading/range/visible-total count, scope, compact 2x2 complete-set summary, compact period controls, visible search + Filters count, removable chips, grouped feed, then Show 10 more.
2. Mobile shows all four totals without stacking them one-per-row; desktop may expand the grid.
3. Period uses Day/Week/Month/Custom plus icon-sized Previous/Next controls with accessible names. Custom dates are inside the mobile filter sheet and inline on desktop.
4. Account, Category, Status, Inclusion, and custom dates are in an accessible modal sheet on mobile and inline on desktop. Filter changes/removals reset reveal/continuation state and update the canonical URL only after a successful refresh.
5. Successfully loaded data remains visible during refresh and compact recoverable errors stay contained.
6. Rows are grouped by non-collapsible Today, Yesterday, or localized date headings in `model.timeZone`; each row is a 52-56px-minimum full-width touch target with merchant/description + amount on line one and account + effective category on line two.
7. Default rows show only exceptional Pending, Excluded, and Manual badges; they do not repeat date, scope, source, or kind text already available from context/details.
8. Selecting a row fetches its source-aware endpoint and opens a read-only modal sheet. The sheet shows a skeleton, contained retry error, all returned metadata, no mutation/export controls, traps focus, closes on Escape or explicit close, restores row focus, prevents background scroll while open, and leaves feed scroll position unchanged.
9. Mobile starts at 10 and expands by 10 using GH-65 pagination, preserving scroll and announcing the new visible count. Desktop starts at up to 50.
10. Mobile contains no export, manual-entry, categorization, merchant-rule, or deletion controls. Desktop retains up to 50-row review, inline advanced filters, Manage, and compact CSV export.
11. The page has no horizontal overflow at 390px; interactive mobile targets are at least 44px.

## API Acceptance Tests

| ID      | Scenario                                    | Expected Result                                                                                  |
| ------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| API-001 | Fetch an authorized Plaid row               | 200 and complete Plaid detail, including account/original/effective categories and metadata note |
| API-002 | Fetch an authorized Manual row              | 200 and complete manual detail with null account/original category and preserved notes           |
| API-003 | Use an unsupported source or malformed UUID | 400 sanitized invalid-request response; no query for malformed input                             |
| API-004 | Request an absent or unauthorized row       | 404 sanitized not-found response with no cross-scope leakage                                     |
| API-005 | Authentication/membership context fails     | Existing sanitized 401/403 response contract is preserved                                        |

## Frontend Acceptance Tests

| ID     | User Action                                                  | Expected Result                                                                                                                                                                  |
| ------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FE-001 | Render at 390px                                              | Heading/range/count, scope, all four compact totals, controls, and newest grouped rows follow the required order with no horizontal overflow and 44px targets                    |
| FE-002 | Open Filters, operate fields/custom dates, close with Escape | Labelled modal traps focus, applies existing controller behavior, reports active count, and restores trigger focus                                                               |
| FE-003 | Remove applied filter chips                                  | Correct field resets, reveal depth returns to 10, successful refresh updates URL, and retained rows survive failures                                                             |
| FE-004 | Inspect a mixed Plaid/manual feed                            | Today/Yesterday/localized groups are non-collapsible; dense rows use two-line hierarchy and only Pending/Excluded/Manual badges                                                  |
| FE-005 | Open a successful detail                                     | Source-aware URL is fetched; skeleton becomes full metadata; no mutation/export action exists; close restores row focus and scroll                                               |
| FE-006 | Detail fetch fails then Retry succeeds                       | Error remains inside the sheet, retry refetches the same source/id, and the feed remains usable after close                                                                      |
| FE-007 | Expand a mobile feed                                         | Exactly 10 more become visible, scroll is not reset, and the live region announces the new visible count                                                                         |
| FE-008 | Render desktop                                               | Up to 50 rows, inline advanced filters, Manage, and compact CSV export remain available                                                                                          |
| FE-009 | Run responsive browser journeys                              | Mobile/desktop hierarchy, filters, grouping, expansion, details, failure behavior, hidden mobile actions, overflow, targets, and screenshots are covered without network mocking |

## Test Status

- [x] API-001 through API-005: PASS (route + direct service coverage)
- [x] FE-001 through FE-008: PASS (component coverage)
- [x] FE-009: Authored in `e2e/dashboard.spec.ts`; the one configured run reached no browser cases because its initial web server found a route collision. The corrected route passes dev startup and production build verification; no local browser pass is claimed.
