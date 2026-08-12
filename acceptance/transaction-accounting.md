# Transaction Accounting and Analytics - Acceptance Criteria

## Description

Budget App has one reusable accounting contract for imported and manual transactions. It preserves bank-source facts, makes user classification and exclusion choices separately, and produces consistent CAD summaries across pending activity and Canadian calendar ranges.

## Interface Contract

There are no new HTTP endpoints or UI components. The shared interface is a pure TypeScript module at `src/lib/transactions/accounting.ts` plus a database migration for user-owned metadata.

### Data Models

- `TransactionKind`: `"income" | "spending" | "transfer" | "refund"`.
- `TransactionSource`: `"plaid" | "manual"`.
- `AccountingPeriod`: `"day" | "week" | "month" | "custom"`.
- `AccountingTransaction` fields:
  - `id: string`
  - `source: TransactionSource`
  - `amountCents: number` — Plaid uses its source convention (positive outflow, negative inflow); manual entries use app convention (positive inflow, negative outflow).
  - `currencyCode: string`
  - `date: string` — local `YYYY-MM-DD` accounting date.
  - `pending?: boolean`
  - `providerTransactionId?: string`
  - `pendingTransactionId?: string | null` — a posted Plaid transaction points to its pending predecessor.
  - `removed?: boolean`
  - `providerCategoryPrimary?: string | null`
  - `providerCategoryDetailed?: string | null`
  - `name?: string | null`
  - `kindOverride?: TransactionKind | null`
  - `excluded?: boolean`
  - `categoryId?: string | null`
- `AccountingLine` adds normalized `cashFlowCents`, resolved `kind`, and `inclusion: "included" | "transfer" | "excluded" | "superseded"`.
- `DateRange`: inclusive `{ startDate: string; endDate: string }` using local date strings.
- `AccountingSummary`: `incomeCents`, `spendingCents`, `refundsCents`, `netFlowCents`, `transferCents`, `pendingCount`, `includedCount`, `excludedCount`, and `categorySpendingCents: Record<string, number>`.

### Exported Functions

- `normalizeCashFlowCents(transaction): number`
- `classifyTransaction(transaction): TransactionKind`
- `resolveAccountingLine(transaction, supersededProviderIds?): AccountingLine`
- `reconcilePendingTransactions(transactions): AccountingLine[]`
- `formatLocalDate(instant, timeZone): string`
- `getDateRange(period, reference, timeZone, customRange?): DateRange`
- `calculateSummary(transactions, range?): AccountingSummary`

### Database Contract

- Create `public.transaction_kind` with values matching `TransactionKind`.
- Add nullable `transaction_metadata.kind_override public.transaction_kind`.
- Add nullable `transaction_metadata.merchant_rule_id uuid` as workspace-safe rule attribution.
- Preserve `transaction_metadata.note`, `category_id`, and `excluded` as user-owned metadata.
- Preserve Plaid amount, date, merchant/name, pending/status, and provider payload on `transactions`; user metadata must not rewrite them.
- Add `(id, workspace_id)` uniqueness to `merchant_rules`, a composite metadata-to-rule foreign key, and a deferred scope/workspace/category consistency trigger so an attributed rule belongs to the same workspace/privacy domain and, when a metadata category is set, points at that category.

### Business Rules

1. Every cent value must be a safe integer and every included transaction must be CAD; invalid values throw.
2. Plaid positive amounts normalize to negative cash flow and Plaid negative amounts to positive cash flow. Manual amounts are already signed cash flow.
3. Provider transfer categories and credit-card-payment details resolve to `transfer`; salary/payroll, interest, and genuine deposit categories resolve to `income`; refund/reversal details and non-income Plaid inflows resolve to `refund`; other outflows resolve to `spending`.
4. `kindOverride` wins over automatic classification without changing source fields.
5. Transfers stay visible but are excluded from income, spending, category spending, and net flow by default. Changing the kind override can include them.
6. Refunds add to `refundsCents` and reduce total/category spending rather than income.
7. Explicitly excluded transactions stay visible but contribute to no financial totals or pending count.
8. Unreconciled pending activity contributes to summaries and pending count. If a live posted transaction references a pending predecessor, the pending line becomes `superseded` and contributes nothing, regardless of input order.
9. Removed transactions contribute nothing.
10. Net flow is genuine income minus net spending after refunds; transfer cash flow is reported separately as an absolute gross amount.
11. Day, Monday-Sunday week, calendar month, and custom boundaries are inclusive local calendar dates in a valid configured Canadian IANA timezone. Invalid timezones, dates, periods, or reversed custom ranges throw.

## Domain Acceptance Tests

| ID      | Scenario                                                | Expected result                                                        |
| ------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| DOM-001 | Plaid debit/credit and manual signed amounts            | Normalized cash-flow signs are consistent and cent-safe                |
| DOM-002 | Salary, interest, deposit, ordinary purchase            | Income/spending kinds and totals are correct                           |
| DOM-003 | Transfer and credit-card payment                        | Visible transfer lines do not inflate income/spending/net flow         |
| DOM-004 | Refund and reversal                                     | Refund amount reduces total and category spending, never income        |
| DOM-005 | Pending plus posted replacement in either order         | Only the posted replacement contributes                                |
| DOM-006 | Unreconciled pending activity                           | It contributes and increments `pendingCount`                           |
| DOM-007 | Kind override and explicit exclusion                    | User metadata changes classification/inclusion without source mutation |
| DOM-008 | CAD and safe-cent validation                            | Non-CAD or unsafe/non-integer amounts throw                            |
| DOM-009 | Vancouver/Toronto boundary instants, Monday week, month | Inclusive local ranges remain correct across UTC/day/DST boundaries    |
| DOM-010 | Custom range and category aggregation                   | Inclusive filtering and per-category net spending are correct          |

## Database Acceptance Tests

| ID         | Scenario                                          | Expected result                                                                                                      |
| ---------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| DB-ACC-001 | Migration structure                               | Enum and metadata override/rule columns exist with workspace-safe FK                                                 |
| DB-ACC-002 | Same-domain rule attribution                      | Matching workspace/scope/category attribution succeeds                                                               |
| DB-ACC-003 | Cross-workspace/privacy/category rule attribution | Deferred constraint rejects mismatches                                                                               |
| DB-ACC-004 | User metadata update                              | Note, exclusion, category, kind override, and rule attribution can change while Plaid source fields remain immutable |

## Test Status

- [x] DOM-001 through DOM-010: PASS (14 Vitest cases)
- [x] DB-ACC-001 through DB-ACC-004: PASS (14 pgTAP assertions; 260 database assertions total)
