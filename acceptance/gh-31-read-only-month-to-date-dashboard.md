# GH-31 Read-Only Month-to-Date Dashboard - Acceptance Criteria

## Description

The dashboard answers one question at a glance: where does this Family or Personal scope stand this month, right now? It is a compact, read-only overview of aggregate budget health, cumulative spending versus recent history, and account balances; transaction exploration remains on `/transactions`.

## Interface Contract

This is the shared agreement between the Test Writer and the Implementer. The existing transaction explorer continues to use `readDashboard` and `/api/dashboard` unchanged. GH-31 introduces an isolated overview read model so the dashboard refactor cannot regress GH-30 filtering or GH-12 export behaviour.

### API Endpoint

| Method | Path                      | Request                                                       | Response (success)               | Response (error)                                                                            |
| ------ | ------------------------- | ------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------- |
| GET    | `/api/dashboard/overview` | Query: `scope=family\|personal`; no date or filter parameters | `200 DashboardOverviewReadModel` | `400 { error, fields? }`, `401/403 { error }`, or `500 { error: "Dashboard unavailable." }` |

The route is request-time only. Each call determines today's date in `America/Toronto`; it never trusts a browser-supplied date, period, range, or timezone.

### Data Model

```ts
type DashboardOverviewReadModel = {
  scope: "family" | "personal";
  timeZone: "America/Toronto";
  asOfDate: string; // YYYY-MM-DD in timeZone
  range: { startDate: string; endDate: string }; // month start through asOfDate
  budgetHealth: {
    hasBudgets: boolean;
    targetCents: number | null;
    spentCents: number;
    remainingCents: number | null;
    progressPercent: number | null;
    daysElapsed: number; // inclusive, so the first day is 1
    daysRemaining: number;
    daysInMonth: number;
    expectedPercent: number;
    pace: "under" | "at" | "over" | null;
  };
  comparison: {
    baselineMonthCount: 0 | 1 | 2 | 3;
    points: Array<{
      day: number;
      date: string; // current-month YYYY-MM-DD
      currentCumulativeCents: number;
      baselineAverageCents: number | null;
    }>;
  };
  accounts: Array<{
    id: string;
    name: string;
    mask: string | null;
    subtype: "chequing" | "savings" | "credit_card";
    availableCents: number | null;
    currentCents: number | null;
    freshnessAt: string | null;
  }>;
};
```

### Business Rules

1. The current range is the first day of the current calendar month through today in `America/Toronto`, recomputed on every page and API request.
2. Family and Personal are mutually exclusive privacy domains. Personal queries require `owner_profile_id = current user`; Family queries require `owner_profile_id IS NULL`. A Combined value is invalid and unreachable.
3. Current and historical spending use existing accounting semantics after pending reconciliation: included ordinary spending increases cumulative spend, included refunds reduce it, and income, transfers, exclusions, removed rows, and superseded pending rows do not count.
4. When budgets exist for the current month, `targetCents` is the sum of the effective target for each budgeted category. `spentCents` is current-month spending/refunds assigned to those budgeted categories only, `remainingCents = targetCents - spentCents`, and `progressPercent = spentCents / targetCents * 100` (zero target yields `0`, never `NaN`).
5. With no effective budgets, `hasBudgets=false`; target, remaining, progress, and pace are `null`; `spentCents` still reports all included current-month spending; day counts remain populated.
6. Expected pace is `daysElapsed / daysInMonth * 100`. Actual pace is compared with integer cross-products. A difference within one percentage point is `at`; below that band is `under`; above it is `over`. Pace is conveyed by text and a distinct shape/icon, not colour alone.
7. The current cumulative curve contains one point for each day from 1 through today and is never projected beyond today. Missing days carry the previous cumulative value.
8. The baseline considers the three immediately preceding calendar months. A prior month counts as available history when it contains at least one included spending or refund ledger row after reconciliation; a zero-net month with qualifying rows still counts.
9. For current day `d`, each available prior month contributes its cumulative amount through `min(d, daysInThatMonth)`. This clamps February and other shorter months at month end instead of misaligning array indexes. The baseline value is the rounded integer-cent average of the available months.
10. `baselineMonthCount` is the actual count used. With zero months every baseline value is `null` and the UI explains that history is unavailable. With one or two months the UI names that count and never calls it a three-month average.
11. Null available or current balances render as `Unavailable`, never `$0.00`. Every account shows name, optional mask, both balances, and freshness or `Freshness unavailable`.
12. The dashboard contains no period navigation, custom range, search, filter, export, category list, per-category budget list, or transaction list. The scope switch is the only interactive control.
13. Accent controls use `bg-brand text-on-accent`. Intended middot (`·`) and em dash (`—`) characters are valid UTF-8; the known mojibake sequences are absent from the dashboard component.
14. The comparison graphic has a complete table fallback conveying the same day/current/baseline values. It has no required animation and remains understandable under `prefers-reduced-motion`.
15. The route skeleton preserves the route's `<main id="main-content" tabIndex={-1}>`, container geometry, data-free polite busy state, and reduced-motion conventions. Its only content blocks map one-to-one to heading/scope, budget health, comparison chart, and account balances.

### UI Components and Stable Selectors

`FinancialDashboard` receives one serializable `DashboardOverviewReadModel` prop and owns only the scope-switch refresh state.

| Element               | `data-testid`                                                                                              | Behaviour                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Compact heading       | `dashboard-heading`                                                                                        | Short month-to-date heading; no display-sized viewport takeover     |
| Scope buttons         | `dashboard-scope-family`, `dashboard-scope-personal`                                                       | 44px minimum target, `aria-pressed`, only interactive controls      |
| Refresh status/error  | `dashboard-loading`, `dashboard-error`                                                                     | Empty-mounted polite status; failed refresh retains prior model     |
| Budget block          | `dashboard-budget-health`                                                                                  | Above-the-fold aggregate block at 390px                             |
| Budget figures        | `dashboard-budget-spent`, `dashboard-budget-target`, `dashboard-budget-remaining`, `dashboard-budget-days` | Currency/day values or explicit no-budget copy                      |
| Pace state            | `dashboard-budget-pace`                                                                                    | Text plus distinct shape; `data-pace=under\|at\|over\|unavailable`  |
| Chart                 | `dashboard-comparison-chart`                                                                               | Visual cumulative current/baseline curves; no forward extrapolation |
| Baseline note         | `dashboard-baseline-note`                                                                                  | Names 0/1/2/3 history months accurately                             |
| Non-visual equivalent | `dashboard-comparison-table`                                                                               | Accessible table for every plotted point                            |
| Account region        | `dashboard-account-list`                                                                                   | Cards containing name, mask, balances, and freshness                |

## Domain Acceptance Tests

| ID       | Scenario                                                                         | Expected Result                                                                         |
| -------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| UNIT-001 | Request instant crosses UTC midnight but not Toronto midnight                    | `asOfDate` and month range follow Toronto, not UTC                                      |
| UNIT-002 | Month has effective budgets and categorized spend/refunds                        | Aggregate target, budgeted spend, remaining, day counts, and pace are exact             |
| UNIT-003 | Scope has no effective budgets                                                   | Plain no-budget model, all-spend total, no null arithmetic or `NaN`                     |
| UNIT-004 | Current month has missing transaction days                                       | Cumulative points carry forward and stop exactly at today                               |
| UNIT-005 | Three prior months have 28, 30, and 31 days                                      | Baseline aligns by day number and clamps shorter months at their final cumulative value |
| UNIT-006 | Only one or two prior months contain qualifying history                          | Count and average use only those months; they are not labelled as three months          |
| UNIT-007 | No prior month has qualifying history                                            | Count is zero and every baseline point is `null`                                        |
| UNIT-008 | Rows include transfers, income, exclusions, superseded pending rows, and refunds | Only included reconciled spending/refunds affect current and baseline curves            |

## API Acceptance Tests

| ID      | Scenario                        | Request               | Expected Response                                                                  |
| ------- | ------------------------------- | --------------------- | ---------------------------------------------------------------------------------- |
| API-001 | Authenticated Family overview   | `GET ?scope=family`   | `200`, Family-scoped overview with request-current Toronto range                   |
| API-002 | Authenticated Personal overview | `GET ?scope=personal` | `200`, service receives Personal scope and current user boundary                   |
| API-003 | Invalid or Combined scope       | `GET ?scope=combined` | `400` with stable error body; service does not read data                           |
| API-004 | Missing authentication          | `GET ?scope=family`   | Existing auth mapper returns `401`/`403` without financial data                    |
| API-005 | Read failure                    | `GET ?scope=family`   | `500 { error: "Dashboard unavailable." }` without leaking provider/database detail |

## Frontend Acceptance Tests

| ID     | User Action                                          | Expected Result                                                                                                                                           |
| ------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FE-001 | Render a three-month Family model                    | Compact budget health, text-and-shape pace, comparison chart/table, baseline count, and accounts are readable                                             |
| FE-002 | Render no budgets and no history                     | Explicit no-budget and no-baseline copy; no `NaN`; null balances are `Unavailable`                                                                        |
| FE-003 | Switch Family to Personal                            | Fetches only `/api/dashboard/overview?scope=personal`, updates every region, exposes no Combined control, and uses `text-on-accent` on the selected scope |
| FE-004 | Scope refresh fails                                  | Alert is announced and the last successful overview remains visible and usable                                                                            |
| FE-005 | Inspect the read-only surface                        | Period/search/filter/export/category/budget-list/transaction controls are absent; intended UTF-8 separators remain intact                                 |
| FE-006 | View at 390px, 768px, and 1280px with reduced motion | No horizontal overflow; key budget figures are visible in the initial 390px viewport; scope targets are at least 44px; chart/table remain understandable  |
| FE-007 | Trigger the dashboard route fallback                 | Skeleton has the correct main wrapper and exactly the heading/scope, budget, comparison, and account block shapes with no fabricated data                 |

## Verification Gates

- [x] UNIT-001 through UNIT-008 pass.
- [x] API-001 through API-005 pass.
- [ ] FE-001 through FE-007 pass or are fixture-gated with an explicit reason in the configured Playwright harness. FE-001 through FE-005 pass in component coverage; FE-006 and FE-007 are authored but the browser harness did not start because the Volta-managed `npm` launcher is missing `npm-prefix.js`.
- [x] `pnpm format:check`
- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test` — 880/880.
- [x] `pnpm build`
- [x] Configured E2E command ran at most once in Phase 5; it exited before Playwright started because of the local npm launcher failure.
