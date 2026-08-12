# Family and Personal Financial Dashboards - Acceptance Criteria

## Description (client-readable)

Members can read household finances in an explicit Family scope or their own private Personal scope. The dashboard explains cash flow, category and budget usage, cached account balances, and the transactions behind the numbers without ever presenting a Combined view or leaking another member's Personal data.

## Interface Contract

### API Endpoints

| Method | Path                | Request                                                                                                                                                                                                                                                                                                                             | Response (success)                                                                                                                          | Response (error)                                                              |
| ------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| GET    | `/api/dashboard`    | Query: `scope=family\|personal`; `period=day\|week\|month\|custom`; `reference=YYYY-MM-DD`; custom additionally requires `from` and `to`; optional `accountId`, `categoryId`, `status=all\|pending\|posted`, `inclusion=default\|included\|excluded\|transfers\|all`, `search` (trimmed, max 100), and `limit` (1-100, default 50). | `200 DashboardReadModel` below.                                                                                                             | `400 { error: "Invalid request.", fields }`; `401 { error }`; `403 { error }` |
| GET    | `/api/transactions` | Existing query plus the same scope/date/account/category/status/inclusion/search filters.                                                                                                                                                                                                                                           | `200 { transactions, manualEntries, summary }`; totals are calculated from the complete filtered result before `limit` slices display rows. | Same validation/auth errors as above.                                         |

### Data Models

```ts
type Scope = "family" | "personal";
type DashboardReadModel = {
  scope: Scope;
  period: "day" | "week" | "month" | "custom";
  range: { startDate: string; endDate: string };
  timeZone: string; // configured Canadian IANA timezone, default America/Toronto
  summary: {
    incomeCents: number;
    spendingCents: number; // refunds netted; transfers/excluded omitted
    netFlowCents: number;
    pendingAmountCents: number;
    pendingCount: number;
    includedCount: number;
    excludedCount: number;
  };
  trend: Array<{ date: string; incomeCents: number; spendingCents: number }>;
  categories: Array<{
    id: string;
    name: string;
    color: string | null;
    spendingCents: number;
    budgetCents: number | null;
    progressPercent: number | null;
  }>;
  accounts: Array<{
    id: string;
    name: string;
    mask: string | null;
    subtype: "chequing" | "savings" | "credit_card";
    availableCents: number | null;
    currentCents: number | null;
    freshnessAt: string | null;
  }>;
  transactions: Array<{
    id: string;
    source: "plaid" | "manual";
    scope: Scope;
    accountId: string | null;
    accountName: string | null;
    merchantOrDescription: string;
    category: { id: string; name: string; color: string | null } | null;
    amountCents: number;
    date: string;
    pending: boolean;
    kind: "income" | "spending" | "transfer" | "refund";
    excluded: boolean;
  }>;
  filterOptions: {
    accounts: Array<{ id: string; name: string }>;
    categories: Array<{ id: string; name: string }>;
  };
};
```

Cached Plaid balance fields are nullable integer cents (`available_balance_cents`, `current_balance_cents`, `credit_limit_cents`, `balance_updated_at`) and are service-written only. `availableCents` uses Plaid available when supplied, otherwise remains null; it is never fabricated from current balance. Credit limits are persisted but not treated as cash.

### Business Rules

1. There are exactly two scopes. Family includes Family rows only; Personal includes only rows owned by the signed-in profile. No endpoint or UI offers Combined.
2. Scope filtering occurs in database queries before aggregation. PostgreSQL RLS remains the primary privacy boundary; application filters are defense in depth.
3. Calendar day, Monday-Sunday week, calendar month, and custom ranges use one validated Canadian IANA timezone. Previous/next navigation preserves period size and filters.
4. Summary and chart totals use all matching rows through stable paged reads before any 50-row display limit.
5. Transfers, excluded rows, removed tombstones, and superseded pending predecessors never enter default income/spending/net/budget totals. Transfers and excluded rows remain visible when the matching inclusion filter is requested.
6. Pending amount is the absolute CAD value of visible, non-transfer, non-excluded pending lines. Pending rows also remain in the appropriate income/spending totals until posted reconciliation supersedes them.
7. Refunds reduce spending and category progress; category progress is net spending divided by the active overlapping budget and may exceed 100%.
8. Search is case-insensitive over merchant/description and account display/name. Account, category, status, inclusion, search, scope, and date filters are applied consistently to rows and summary totals.
9. Manual entries have source `manual`, no account, and are never pending. Plaid rows expose account and pending state. Both use the same normalized transaction row contract.
10. Account balances are cached provider facts with explicit freshness. Null provider balances render as unavailable, not `$0.00`.
11. All currency is CAD and crosses the domain/UI boundary as safe integer cents.

### UI Components

- `FinancialDashboard({ initialModel })` is the interactive client surface on `/dashboard`.
- Required test IDs: `dashboard-scope-family`, `dashboard-scope-personal`, `dashboard-period-day`, `dashboard-period-week`, `dashboard-period-month`, `dashboard-period-custom`, `dashboard-previous-period`, `dashboard-next-period`, `dashboard-summary-income`, `dashboard-summary-spending`, `dashboard-summary-net`, `dashboard-summary-pending`, `dashboard-cash-flow-chart`, `dashboard-category-list`, `dashboard-budget-list`, `dashboard-account-list`, `dashboard-search`, `dashboard-account-filter`, `dashboard-category-filter`, `dashboard-status-filter`, `dashboard-inclusion-filter`, `dashboard-transaction-list`, `dashboard-loading`, and `dashboard-error`.
- Scope and filter changes request `/api/dashboard`, show an announced loading state, replace all read-model regions atomically, and expose an actionable error without discarding the last successful model.
- Charts have accessible text/table equivalents; information is not encoded by colour alone. Pending, excluded, transfer, source, and privacy scope are visible as text.
- Desktop uses an editorial financial field-report composition; mobile stacks controls and cards without horizontal page overflow. Keyboard focus and reduced-motion preferences are respected.

## API Acceptance Tests

| ID      | Scenario                       | Precondition                                           | Request                                                             | Expected Response                                                                       |
| ------- | ------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| API-001 | Family month read model        | Active member; Family and Personal fixtures            | `GET /api/dashboard?scope=family&period=month&reference=2026-08-12` | 200; Family rows only; correct range and totals                                         |
| API-002 | Personal privacy               | Two members have Personal rows                         | Personal dashboard as member A                                      | 200; A's rows only, never B's                                                           |
| API-003 | Filter consistency             | Mixed accounts/categories/statuses                     | Dashboard with account/category/pending filters                     | Rows, summary, chart, and category totals reflect the same subset                       |
| API-004 | Inclusion semantics            | Included, transfer, and excluded rows                  | Default then `inclusion=all`                                        | Default totals omit transfer/excluded; `all` reveals rows without adding them to totals |
| API-005 | Complete aggregation           | More than 100 matching rows                            | Dashboard limit 10                                                  | Summary covers all matching rows; transaction display has at most 10                    |
| API-006 | Period validation              | Active member                                          | Invalid date/range/time combination                                 | 400 field response                                                                      |
| API-007 | Search                         | Matching merchant/account and nonmatching rows         | Case-insensitive search                                             | Only matching rows and their totals are returned                                        |
| API-008 | Cached balances                | Plaid supplied available/current balance and sync time | Scope dashboard                                                     | Account cents and freshness are returned; missing available remains null                |
| API-009 | Authentication                 | No user                                                | Dashboard request                                                   | 401, no financial payload                                                               |
| API-010 | Extended transactions endpoint | Mixed Plaid/manual fixture                             | Filtered `GET /api/transactions`                                    | Complete filtered summary and limited rows                                              |

## Frontend Acceptance Tests

| ID     | User Action                                                  | Expected Result                                                                                                   |
| ------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| FE-001 | Open dashboard and switch Family to Personal                 | All cards, charts, budgets, accounts, and transactions update together; no Combined control exists                |
| FE-002 | Navigate month backward/forward and select custom dates      | Visible period label/range and the full model update with Monday-Sunday week semantics where applicable           |
| FE-003 | Search and combine account/category/status/inclusion filters | Transaction rows and totals remain consistent; pending/source/exclusion/transfer labels are visible               |
| FE-004 | Review summary, cash-flow, budget, and account regions       | CAD values, accessible chart fallback, over-budget state, null balance state, and freshness copy render correctly |
| FE-005 | Force a refresh failure                                      | Error is announced and the last successful dashboard remains usable                                               |
| FE-006 | Use desktop/mobile keyboard and reduced motion               | No horizontal page overflow; focus is visible; controls have accessible names; screenshots are captured           |

## Database Acceptance Tests

| ID     | Scenario                                              | Expected Result                                                                     |
| ------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| DB-001 | Member selects account balance fields under RLS       | Family plus own Personal accounts only; another member's Personal account is absent |
| DB-002 | Authenticated member attempts direct balance mutation | Rejected; balance cache remains service-controlled                                  |

## Test Status

- [x] API-001 through API-010: Passed (Vitest)
- [x] FE-001 through FE-006: Passed in component coverage; real-backend Playwright is authored and fixture-gated locally
- [x] DB-001 through DB-002: Passed (pgTAP)
