# GH-30 Transactions Exploration and Export - Acceptance Criteria

## Description (client-readable)

A household member can explore the ledger from the Transactions tab itself: search it, narrow it by account, category, status and inclusion, move through days, weeks, months or a custom range, and download exactly the view on screen as a safe CSV. The view they build is in the address bar, so reloading keeps it and sending the link shares it. Family and Personal stay separate, and there is still no combined view.

This is a relocation for parity. Every behaviour listed here already works on `/dashboard`; nothing about accounting, privacy scoping, pagination limits, or CSV column policy changes.

## Interface Contract

### Reused endpoints (unchanged — no server work in this ticket)

| Method | Path                       | Notes                                                                                                        |
| ------ | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/dashboard`           | Validated by `dashboardQuerySchema` (strict). Returns `DashboardReadModel`. Already scope/date/filter aware. |
| GET    | `/api/transactions/export` | Validated by `dashboardExportQuerySchema` (strict). Already emits BOM + RFC 4180 + formula neutralization.   |

`readDashboard` computes `summary` from `aggregateRows`, which is the complete filtered set **before** the inclusion filter and the display `limit` slice. Reusing it is what satisfies "summary totals reflect the complete filtered set rather than the rendered page" — no new aggregation is written.

`serializeTransactionCsv` already returns the header row alone (with the BOM and a trailing CRLF) for an empty set, so "headers only" needs no server change either.

### New module: `src/lib/transactions/explorer-filters.ts`

```ts
export type ExplorerScope = "family" | "personal";
export type ExplorerPeriod = "day" | "week" | "month" | "custom";
export type ExplorerStatus = "all" | "pending" | "posted";
export type ExplorerInclusion =
  "default" | "included" | "excluded" | "transfers" | "all";

export type ExplorerFilters = {
  scope: ExplorerScope;
  period: ExplorerPeriod;
  reference: string; // YYYY-MM-DD
  from: string; // YYYY-MM-DD; only meaningful when period === "custom"
  to: string; // YYYY-MM-DD; only meaningful when period === "custom"
  search: string; // "" when unset
  accountId: string; // "" when unset
  categoryId: string; // "" when unset
  status: ExplorerStatus;
  inclusion: ExplorerInclusion;
};

/** Untrusted URL input in, always-valid filters out. Never throws. */
export function parseExplorerFilters(
  raw: URLSearchParams | Record<string, string | string[] | undefined>,
  today: string,
): ExplorerFilters;

/** The strict `/api/dashboard` + `/api/transactions/export` query shape. */
export function toReadModelQuery(
  filters: ExplorerFilters,
): Record<string, string>;

/** The `/transactions?…` query string. Stable key order; defaults omitted. */
export function toExplorerSearchParams(filters: ExplorerFilters): string;

/** Human-readable labels for every narrowing filter, for the empty state. */
export function describeActiveFilters(
  filters: ExplorerFilters,
  options: {
    accounts: ReadonlyArray<{ id: string; name: string }>;
    categories: ReadonlyArray<{ id: string; name: string }>;
  },
): string[];
```

### Business rules

1. `parseExplorerFilters` never throws and never yields a value the strict server schemas would reject. Unknown or malformed values fall back to the default: `scope=family`, `period=month`, `status=all`, `inclusion=default`, empty `search`/`accountId`/`categoryId`. A `reference` that is not a real `YYYY-MM-DD` calendar date falls back to `today`.
2. `period=custom` requires both `from` and `to` to be real calendar dates with `from <= to`. If either is missing or invalid, or the range is inverted, the period degrades to `month` rather than producing a request the server would reject.
3. When `period === "custom"`, `reference` resolves to `to` — the same convention `FinancialDashboard` uses — so `Previous`/`Next` step by whole range lengths.
4. `toReadModelQuery` emits `from`/`to` **only** when `period === "custom"`, and omits `search`, `accountId`, and `categoryId` when empty. Both server schemas are `.strict()`, so no other key may appear. `limit` is not this module's concern; callers add it.
5. `toExplorerSearchParams` round-trips: `parseExplorerFilters(toExplorerSearchParams(f), today)` equals `f` for every valid `f`. It omits values equal to the defaults, so the default view has a clean URL.
6. `describeActiveFilters` names only filters that actually narrow the set — search text, account, category, non-`all` status, non-`default` inclusion — resolving account and category UUIDs to their display names. Scope and period are not narrowing filters and are not listed.

### New component: `src/components/transactions/transaction-explorer.tsx`

```ts
export type TransactionExplorerProps = {
  initialModel: DashboardReadModel; // from @/lib/dashboard/types
  initialFilters: ExplorerFilters;
};
export function TransactionExplorer(
  props: TransactionExplorerProps,
): JSX.Element;
```

Frozen `data-testid` values:

| Test id                                                                           | Element                              |
| --------------------------------------------------------------------------------- | ------------------------------------ |
| `transactions-explorer`                                                           | root section                         |
| `transactions-scope-family`, `transactions-scope-personal`                        | scope buttons                        |
| `transactions-period-day` / `-week` / `-month` / `-custom`                        | period buttons                       |
| `transactions-previous-period`, `transactions-next-period`                        | period navigation                    |
| `transactions-custom-from`, `transactions-custom-to`, `transactions-custom-apply` | custom range form                    |
| `transactions-range-label`                                                        | resolved range text                  |
| `transactions-search`                                                             | free-text search input               |
| `transactions-account-filter`, `transactions-category-filter`                     | account/category selects             |
| `transactions-status-filter`, `transactions-inclusion-filter`                     | status/inclusion selects             |
| `transactions-loading`                                                            | polite live region for refresh state |
| `transactions-error`                                                              | `role="alert"` refresh failure       |
| `transactions-export-csv`                                                         | export anchor                        |
| `transactions-export-reason`                                                      | why export is unavailable            |
| `transactions-summary-income` / `-spending` / `-net` / `-pending`                 | filter-faithful totals               |
| `transactions-result-list`                                                        | filtered result list                 |
| `transactions-result-{id}`                                                        | one result row                       |
| `transactions-empty-state`                                                        | empty result set                     |

### Component behaviour

1. **Seeded, not fetched, on first paint.** `initialModel` renders immediately; no request fires on mount.
2. **Filter changes refetch `/api/dashboard`.** Search is debounced 120 ms; every other control fires immediately. Responses are race-guarded by an incrementing request id so a slow earlier response can never overwrite a newer one.
3. **Scope is URL navigation, not a client fetch.** Selecting a scope pushes `/transactions?…` with `accountId` and `categoryId` cleared (their options are scope-specific) inside a `useTransition`, so the server-rendered Manual/Cash and Plaid sections below re-render in the same scope. The page keys the explorer on the whole applied query (`toExplorerSearchParams(filters)`), so it remounts against the new model on any navigation whose applied query differs from the last render's — scope included. Scope buttons carry `aria-pressed`; there is no Combined control anywhere on the surface.
4. **Filter changes sync the URL without a navigation** via `window.history.replaceState`, so a reload or a shared link reproduces the exact view. A response that lands after the component unmounted must not perform that sync, or the address bar would name a view that is no longer on screen.
5. **Summary totals come from `model.summary`** — the complete filtered set — never from the rendered rows.
6. **Export href is a snapshot of the query that produced the displayed rows**, not of the pending control state, so it can never describe a view the user is not looking at.
7. **Export is unavailable, with a stated reason, in exactly two cases:** a refresh is in flight ("Refreshing the filtered view.") or the filtered set is empty ("No transactions match the current filters."). Unavailable means no `href`, `aria-disabled="true"`, and a suppressed click. It never silently downloads a stale or unfiltered view.
8. **An empty result set renders `transactions-empty-state` naming the active filters** from `describeActiveFilters`, or stating that the period itself is empty when no narrowing filter is applied. The filters it names are the ones the rendered rows were produced by, not the live controls — after a rejected refresh those disagree. An account or category id with no matching option is named as unavailable rather than echoed as a raw UUID, and its select carries an explicit "Unavailable" option so the control cannot read "All" while the request stays narrowed.
9. **A failed refresh keeps the last successful model**, announces `role="alert"`, and says which scope's retained data is on screen — matching the dashboard's behaviour.
10. **The live region is mounted empty and only its contents toggle** (per the project's live-region rule); it is never inserted with its text already present.

### Page composition: `src/app/(app)/transactions/page.tsx`

Header → `TransactionExplorer` (controls, filter-faithful summary, filtered ledger) → existing Manual/Cash workbench → existing Plaid categorization register.

- The old static all-time `scoped-ledger-summary` section is replaced by the explorer's filter-faithful summary. Nothing referenced its test ids.
- The old `Link`-based scope `<nav>` is replaced by the explorer's scope control, so exactly one scope selector exists on the surface.
- The Manual/Cash workbench and the Plaid register stay: they are the editing surfaces, and GH-7 `categories.spec.ts` and GH-8 coverage depend on them.

### Responsive and accessibility

At 390 px the controls stack, `document.scrollWidth <= document.clientWidth`, every interactive control is at least 44 px on its smallest side, every control has an accessible name, and the controls sit above the ledger without overlaying it.

## Unit / Component Acceptance Tests

| ID       | Scenario                                                                                     | Expected result                                                                                     |
| -------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| UNIT-001 | `parseExplorerFilters` on empty input                                                        | Defaults, with `reference` = the supplied `today`                                                   |
| UNIT-002 | `parseExplorerFilters` on garbage (`scope=combined`, `status=maybe`, `reference=2026-02-30`) | Falls back per rule 1; never throws; no Combined scope is representable                             |
| UNIT-003 | `period=custom` with missing / invalid / inverted `from`,`to`                                | Degrades to `month`                                                                                 |
| UNIT-004 | `period=custom` with a valid range                                                           | `reference` resolves to `to`                                                                        |
| UNIT-005 | `toReadModelQuery` for a non-custom period with empty optionals                              | No `from`/`to`/`search`/`accountId`/`categoryId` keys; survives `dashboardQuerySchema` with a limit |
| UNIT-006 | `toReadModelQuery` for a fully-populated custom filter set                                   | Survives `dashboardExportQuerySchema` unchanged                                                     |
| UNIT-007 | `toExplorerSearchParams` → `parseExplorerFilters` round-trip                                 | Identity for every valid filter object                                                              |
| UNIT-008 | `describeActiveFilters` with search + account + category + status + inclusion                | Names each, resolving UUIDs to display names; omits scope and period                                |
| COMP-001 | Mount with `initialModel`                                                                    | Rows, totals and range render with no `fetch` call                                                  |
| COMP-002 | Apply two filters (status + inclusion)                                                       | Request carries both; the narrowed result set and its totals render                                 |
| COMP-003 | Totals after a filter change                                                                 | Read from `summary`, not summed from the rendered rows                                              |
| COMP-004 | Export href after filters are applied                                                        | `/api/transactions/export` with exactly the query that produced the displayed rows                  |
| COMP-005 | Export while a refresh is in flight                                                          | `aria-disabled="true"`, no href, reason stated                                                      |
| COMP-006 | Export with an empty result set                                                              | `aria-disabled="true"`, no href, reason stated                                                      |
| COMP-007 | Empty result set                                                                             | `transactions-empty-state` names the filters that produced it                                       |
| COMP-008 | Filter change settles                                                                        | `window.history.replaceState` called with the matching `/transactions?…` URL                        |
| COMP-009 | Scope selection                                                                              | `router.push` to the new scope with account/category cleared; no combined option exists             |
| COMP-010 | Failed refresh                                                                               | Retained model still on screen; `role="alert"`; message names the retained scope                    |
| COMP-011 | Race: a slow earlier response resolves after a newer one                                     | The newer response wins                                                                             |
| COMP-012 | Every control                                                                                | Has an accessible name                                                                              |
| COMP-013 | Export href after a rejected refresh                                                         | Reverts to the last successful snapshot; never describes the rejected filters                       |
| COMP-014 | A response lands after the component unmounted                                               | No `replaceState`; the address bar is not rewritten to the view just left                           |
| COMP-015 | Empty state after a rejected refresh                                                         | Names the retained filters, not the rejected ones                                                   |
| COMP-016 | Active account id with no matching option                                                    | Select shows an explicit "Unavailable account"; the empty state names it without echoing the UUID   |
| COMP-017 | Custom dates typed but never applied, then the period leaves and re-enters `custom`          | The abandoned dates are discarded and never reach a request                                         |

COMP-013 through COMP-017 were added after independent review found the corresponding defects. Each was verified to **fail** against the pre-fix code, not merely to pass against the fixed code.

## Browser Acceptance Tests (re-pointed to `/transactions`)

| ID      | Origin                         | Scenario                                                                        |
| ------- | ------------------------------ | ------------------------------------------------------------------------------- |
| FE-002  | GH-9 `dashboard.spec.ts`       | Previous/next/week/custom period navigation refreshes real calendar ranges      |
| FE-003  | GH-9 `dashboard.spec.ts`       | Combined real filters keep rows and totals aligned                              |
| FE-006  | GH-9 `dashboard.spec.ts`       | 390 px: no overflow, named controls, 44 px targets                              |
| FE-001a | GH-12 `data-lifecycle.spec.ts` | Applied Family filters produce a real scoped CSV download with a clear filename |
| FE-001b | GH-12 `data-lifecycle.spec.ts` | Personal export preserves the exact custom range and never offers Combined      |
| FE-007  | new                            | A filtered view survives reload and is reproduced from a shared link            |

Dashboard-only cases (FE-001 scope/regions, FE-004 readability, FE-005 refresh error) stay on `/dashboard`, which keeps its controls until #31 refactors it.

## Out of Scope

The dashboard refactor (#31). New filter dimensions. The themed select/searchable dropdown redesign (#26) — native controls are kept so #26 can restyle them everywhere at once. Any change to accounting semantics, privacy scoping, pagination limits, or CSV column policy.

#33's shared pending hook has not landed, so refresh pending state is a local boolean here, marked in-code for adoption when #33 lands.
