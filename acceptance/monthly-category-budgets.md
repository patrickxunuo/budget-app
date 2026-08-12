# Monthly Category Budgets - Acceptance Criteria

## Description (client-readable)

Members can set recurring CAD targets for each spending category, see exactly how the current local calendar month is tracking, and preserve an honest historical record when targets change. Family targets are collaborative; Personal targets remain private and owner-controlled.

## Interface Contract

This contract is the shared agreement between the Test Writer and Implementer.

### API Endpoints

| Method | Path                                                   | Request                                                                                                                        | Response (success)             | Response (error)                                                                             |
| ------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------- |
| GET    | `/api/budgets?scope=family\|personal&month=YYYY-MM-01` | Query only; `month` must be the first local-calendar day                                                                       | `200 BudgetMonthReadModel`     | `400 { error: "Invalid request.", fields }`; `401 { error }`; `403 { error }`                |
| POST   | `/api/budgets`                                         | `{ scope, categoryId, amountCents, effectiveMonth }`                                                                           | `201 { budget: BudgetTarget }` | `400`; `401`; `403`; `409 { error: "A target already applies to this category and month." }` |
| PATCH  | `/api/budgets/:id`                                     | `{ amountCents, effectiveMonth }` to create a new effective version, or `{ archived: true, effectiveMonth }` to end recurrence | `200 { budget: BudgetTarget }` | `400`; `401`; `403`; `404`                                                                   |
| GET    | `/api/budgets/:id?month=YYYY-MM-01`                    | Inspect target/version history                                                                                                 | `200 { budget, history }`      | `400`; `401`; `403`; `404`                                                                   |

Dynamic route handlers receive `params: Promise<{ id: string }>` and await it per Next.js 16.3.

### Data Models

```ts
type BudgetScope = "family" | "personal";
type BudgetStatus = "on-track" | "watch" | "close" | "at-limit" | "over";

type BudgetTarget = {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string | null;
  scope: BudgetScope;
  amountCents: number;
  currencyCode: "CAD";
  effectiveMonth: string; // YYYY-MM-01
  endMonth: string | null; // inclusive YYYY-MM-01; null means recurring
  archived: boolean;
};

type BudgetProgress = BudgetTarget & {
  spentCents: number; // net category spending; refunds reduce it
  remainingCents: number; // max(target - spent, 0)
  overBudgetCents: number; // max(spent - target, 0)
  percentageUsed: number; // may exceed 100; 0 when net spend is negative
  status: BudgetStatus;
};

type BudgetMonthReadModel = {
  scope: BudgetScope;
  month: string;
  monthEnd: string;
  currencyCode: "CAD";
  budgets: BudgetProgress[];
  availableCategories: Array<{
    id: string;
    name: string;
    color: string | null;
  }>;
  summary: {
    targetCents: number;
    spentCents: number;
    remainingCents: number;
    overBudgetCents: number;
  };
};
```

### Business Rules

1. Targets are positive safe integer cents in CAD. `effectiveMonth` is the first day of a local calendar month; months reset independently and unused amounts never roll over.
2. At most one target applies to a category, scope, owner, and month. A category must belong to the same workspace/privacy domain as the target.
3. Family targets have no owner and every active member may create, revise, archive, and inspect them. Personal targets are owned by the signed-in member and are invisible and immutable to everyone else, including the family owner.
4. Editing creates a new effective-dated version and closes the prior version at the preceding month; it never rewrites a past applicable amount. Archiving closes recurrence from `effectiveMonth` without deleting history.
5. Progress uses only transactions/manual entries in the same scope and owner domain. Shared accounting rules apply before aggregation: pending spending counts, explicit exclusions and transfers do not, superseded pending rows do not, and refunds reduce category spending.
6. `percentageUsed = max(spentCents, 0) / amountCents * 100`; state boundaries are `<75 on-track`, `75..<90 watch`, `90..<100 close`, `100 at-limit`, and `>100 over`.
7. Every visual state includes text and an icon/shape in addition to colour. The UI shows spent, remaining, percentage used, and over-budget amount when applicable.
8. Archived categories remain readable in historical target inspection but cannot receive a new target. API reads and dashboard integration preserve explicit Family/Personal scope with no Combined view.

### UI Components

- `/budgets` renders a Server Component that obtains the initial scoped month model and passes serializable props to `BudgetWorkbench`.
- `BudgetWorkbench({ initialModel })` is the interactive client boundary and follows the existing editorial financial field-report design system.
- Required test IDs: `budget-workbench`, `budget-scope-family`, `budget-scope-personal`, `budget-month`, `budget-previous-month`, `budget-next-month`, `budget-summary-target`, `budget-summary-spent`, `budget-summary-remaining`, `budget-target-list`, `budget-create`, `budget-form`, `budget-category`, `budget-amount`, `budget-effective-month`, `budget-save`, `budget-cancel`, `budget-edit-{id}`, `budget-archive-{id}`, `budget-progress-{id}`, `budget-status-{id}`, `budget-loading`, and `budget-error`.
- Create/edit/archive updates the whole read model atomically. Loading and error states are announced; an error preserves the last successful model and entered form values.
- Desktop uses a ledger-grid composition; mobile stacks without horizontal page overflow. Keyboard focus and reduced-motion preferences are respected.

## API Acceptance Tests

| ID      | Scenario                               | Precondition                                                     | Request                                          | Expected Response                                                          |
| ------- | -------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------- |
| API-001 | Read Family month                      | Active member; mixed scoped fixtures                             | `GET /api/budgets?scope=family&month=2026-08-01` | Family targets/records only; correct progress and summary                  |
| API-002 | Read Personal privacy                  | Two members have Personal targets                                | Personal read as member A                        | Only A's targets and transactions appear                                   |
| API-003 | Create target                          | Active member and matching active category                       | Valid `POST`                                     | `201`; safe cents/CAD/effective month returned                             |
| API-004 | Reject invalid or duplicate target     | Invalid cents/month or overlapping applicable version            | `POST`                                           | `400` field errors or `409`; no write                                      |
| API-005 | Revise without history drift           | Existing recurring target                                        | `PATCH` with later effective month               | Old month retains old amount; new/later months use new amount              |
| API-006 | Archive recurrence                     | Existing recurring target                                        | `PATCH { archived: true, effectiveMonth }`       | Earlier months remain; archive month and later have no applicable target   |
| API-007 | Accounting semantics                   | Pending, excluded, transfer, refund, posted predecessor fixtures | Month read                                       | Pending counts; excluded/transfer/superseded omitted; refund reduces spend |
| API-008 | Authentication and scope authorization | Anonymous or cross-owner caller                                  | Any route                                        | `401/403/404`; no private payload or mutation                              |
| API-009 | Inspect history                        | Existing revised target                                          | `GET /api/budgets/:id?month=...`                 | Applicable version plus ordered immutable history                          |

## Frontend Acceptance Tests

| ID     | User Action                                     | Expected Result                                                                                     |
| ------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| FE-001 | Switch scope/month and create a category target | Model updates atomically and shows CAD target/progress in the correct privacy scope                 |
| FE-002 | Edit then archive a target                      | Effective month is explicit; historical month stays unchanged; future recurrence disappears         |
| FE-003 | Review 75%, 90%, 100%, and over states          | Each threshold has distinct text/icon semantics and shows spent, remaining, percentage, and overage |
| FE-004 | Force a save failure                            | Error is announced while last model and entered form values remain usable                           |
| FE-005 | Use keyboard and mobile viewport                | Focus is visible, controls are named, no horizontal overflow, and screenshots are captured          |

## Database Acceptance Tests

| ID     | Scenario                                              | Expected Result                                                                                      |
| ------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| DB-001 | Family collaboration and Personal isolation under RLS | Active members mutate Family; only owner can see/mutate Personal                                     |
| DB-002 | Cross-domain category assignment                      | Constraint/RPC rejects mismatched workspace, scope, or owner                                         |
| DB-003 | Effective-dated uniqueness/history                    | Overlap is rejected; revision closes prior version without rewriting it                              |
| DB-004 | Direct table mutation bypass                          | Authenticated direct insert/update/delete is rejected; fixed-search-path RPCs are the write boundary |

## Test Status

- [x] API-001 through API-009: Passed (Vitest)
- [x] FE-001 through FE-005: Passed (component coverage); real-backend Playwright authored and fixture-gated locally
- [x] DB-001 through DB-004: Passed (pgTAP)
