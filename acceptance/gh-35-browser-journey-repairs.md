# GH-35 Browser Journey Repairs - Acceptance Criteria

## Description

Repair the real-backend Manual/Cash and month-to-date dashboard browser journeys that became runnable after GH-14. The work provisions honest, repeatable fixtures and corrects test assumptions without changing product behavior.

## Interface Contract

This is the shared agreement between the Test Writer and the Implementer. The existing application APIs and UI remain unchanged; the contract covers the fixture commands, exported environment variables, and browser assertions.

### Fixture Commands

| Command                   | Purpose                                                            | Required input                                                                                                     | Successful output                                                                                                                   | Failure behavior                                                                                     |
| ------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm seed:e2e`           | Create/reuse the local owner identity and workspace                | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, disposable `E2E_SEED_PASSWORD`; optional `E2E_SEED_EMAIL` | Exports `E2E_MANUAL_ENTRY_MEMBER_EMAIL` and `E2E_MANUAL_ENTRY_MEMBER_PASSWORD` in addition to the existing identity-backed families | Refuses non-loopback Supabase or a missing password and exits non-zero                               |
| `pnpm seed:e2e:financial` | Create/reconcile deterministic financial rows for the seeded owner | Same inputs as `seed:e2e`; identity seed must run first                                                            | Exports `E2E_DASHBOARD_MEMBER_EMAIL` and `E2E_DASHBOARD_MEMBER_PASSWORD`, writing them to `GITHUB_ENV` when present                 | Refuses non-loopback Supabase, a missing password or membership, or failed writes and exits non-zero |

Both commands read process environment first and then `.env.local`. The password has no committed default: local users supply a disposable value privately, while CI generates one for each job. Neither command may emit the service-role key or any provider token.

### Financial Fixture Model

The financial seed reconciles a deterministic, idempotent data set for the seeded owner's workspace:

- One pending fixture-only Plaid Item container owned by the seeded profile. Its placeholder token is deliberately non-syncable, while its linked Family account rows remain live for dashboard reads.
- At least one active Family account with non-null available/current balances and a non-null freshness timestamp.
- At least one active Family account whose nullable balance fields remain `null`, proving the UI renders `Unavailable` rather than `$0.00`.
- One active Family category with an effective current-month budget.
- At least one posted, included Family transaction dated in the current Toronto calendar month and assigned to the budgeted category.
- Stable fixture identifiers or provider keys are reused on every run; rerunning the seed updates/reconciles the same rows instead of accumulating duplicates.

The deterministic assertion values are:

- Budget target `100000` cents (`CA$1,000.00`), posted included spend `25000` cents (`CA$250.00`), and remaining `75000` cents (`CA$750.00`).
- `E2E Family Chequing`: available `245678` cents (`CA$2,456.78`), current `250000` cents (`CA$2,500.00`), and a refreshed timestamp whose rendered row contains `Updated` rather than `Freshness unavailable`.
- `E2E Family Unavailable`: null available/current balances and freshness, rendered as `Unavailable` and never `$0.00`.
- Budget category `E2E Dashboard Groceries`.

### Browser Routes and Selectors

| Surface                 | Route                                                          | Stable selectors                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual ledger           | `/transactions?scope=family` or `/transactions?scope=personal` | `manual-entry-workbench`, `manual-entry-form`, `manual-entry-scope`, `manual-entry-row-{id}`                                                                      |
| Month-to-date dashboard | `/dashboard`                                                   | `dashboard-budget-health`, `dashboard-budget-spent`, `dashboard-budget-target`, `dashboard-budget-remaining`, `dashboard-account-list`, `dashboard-baseline-note` |

### Business Rules

1. The form's `manual-entry-scope` controls the new row's privacy; the URL scope controls which ledger is displayed. A Personal row is never expected on the Family ledger, and vice versa.
2. Manual-entry FE-001 creates both Family and Personal categories explicitly. Category names, entry descriptions, and other fixture data are cleaned up or uniquely scoped per browser run so reruns cannot change later assertions.
3. Manual-entry creation, edit, deletion, CSV, and responsive checks continue to hit real application APIs; no Playwright route interception or response mocking is allowed.
4. Dashboard coverage targets the GH-31 read-only month-to-date overview. It does not restore the period, search, filter, export, category-list, or transaction-list controls removed from `/dashboard`.
5. Dashboard assertions prove real seeded summaries and budget progress, non-null balances and freshness, and the null-balance `Unavailable` state.
6. `manual-entries` is provisioned by `seed:e2e`; `dashboard` is provisioned only after `seed:e2e:financial`.
7. CI runs the identity seed before running the financial seed twice, proving reconciliation is repeatable, and lists both `manual-entries` and `dashboard` in `E2E_REQUIRED_FIXTURES` for the development-mode browser run.
8. The fixture inventory must report both families as `provisioned required`; every still-absent family continues to name its missing variables.

## CLI Acceptance Tests

| ID      | Scenario                            | Precondition                                                       | Action                              | Expected Result                                                                                                 |
| ------- | ----------------------------------- | ------------------------------------------------------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| CLI-001 | Financial seed targets a hosted URL | Non-loopback `NEXT_PUBLIC_SUPABASE_URL`                            | Run the script                      | Exits non-zero before any database call and states that non-loopback projects are refused                       |
| CLI-002 | Financial seed is rerun             | Identity/workspace already exists and one financial seed completed | Run `pnpm seed:e2e:financial` again | Succeeds and reconciles the same deterministic rows without duplicates                                          |
| CLI-003 | CI exports dashboard credentials    | `GITHUB_ENV` points to a temporary file                            | Run the financial seed              | Appends both dashboard credential assignments without printing secrets other than the intended test credentials |

The environment-independent CLI-001 contract is implemented at `src/lib/e2e/seed-e2e-financial-fixtures.test.ts`; CLI-002 and CLI-003 remain real-local-Supabase contracts exercised by the seeded CI workflow.

## Frontend Acceptance Tests

| ID     | User Action                                                                                                | Expected Result                                                                                                                                  |
| ------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| FE-001 | Create one Personal income and two Family spending/refund rows                                             | Each row appears only after opening its matching Personal or Family ledger; source/history labels remain correct                                 |
| FE-002 | Run the remaining serial Manual/Cash edit, validation, deletion, CSV, and responsive journeys after FE-001 | Each journey opens the scope containing the row it manipulates and the complete family passes repeatedly without accumulated fixture assumptions |
| FE-003 | Open the GH-31 month-to-date dashboard with the financial fixture                                          | Budget target, spending, remaining amount, account balances, and freshness reflect real seeded values                                            |
| FE-004 | Inspect the seeded null-balance account                                                                    | Its balance reads `Unavailable`, never `$0.00`                                                                                                   |
| FE-005 | Run the complete configured Playwright suite after both seeds                                              | Zero failing cases; both new families are reported as `provisioned required`                                                                     |

## Test Status

- [x] CLI-001: PASS - hosted URL refusal exits non-zero before client use and does not print the service-role sentinel.
- [x] CLI-002: PASS - a clean local Supabase was seeded twice; both runs reconciled the same `CA$1,000.00` target, `CA$250.00` spend, and `CA$750.00` remainder without duplicates or constraint failures.
- [x] CLI-003: PASS - a disposable `GITHUB_ENV` received exactly the dashboard email and password assignments without provider or service-role material.
- [x] FE-001: PASS - Personal and Family create/visibility assertions pass in both Chromium projects against local Supabase.
- [x] FE-002: PASS - edit, validation, scoped deletion, responsive, and CSV journeys pass in both Chromium projects; browser-side cleanup preserves the authenticated session after download.
- [x] FE-003: PASS - exact budget and available/current balance assertions pass in both Chromium projects.
- [x] FE-004: PASS - the null-balance account renders `Unavailable`, never `$0.00`, in both Chromium projects.
- [x] FE-005: PASS - [PR #54 CI](https://github.com/patrickxunuo/budget-app/actions/runs/31928095966) passed 26/26 production route-loading cases plus 118 development-mode cases, with 52 explicitly inventoried optional-fixture skips and all six required families—including `manual-entries` and `dashboard`—reported provisioned.

Local environment gates: 487/487 pgTAP assertions and the twice-run financial seed pass on Docker-backed Supabase. Non-environment gates: 897/897 Vitest checks, lint, Next route generation/typecheck, changed-file Prettier, and the production build pass.
