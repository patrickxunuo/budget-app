# Dev Environment Setup

## Prerequisites

- Node.js 22 (Node 24 also verified locally)
- pnpm 8.14 through Corepack
- Docker Desktop / Docker Engine
- Project-pinned Supabase CLI through `pnpm exec supabase`
- Playwright Chromium (`pnpm exec playwright install chromium` once)

## First-Time Setup

### 1. Install Dependencies

```powershell
pnpm install --frozen-lockfile
```

### 2. Environment Files

Copy `.env.example` to the ignored `.env.local` and fill every value. Local Supabase URLs/keys come from `pnpm db:start`; Plaid Sandbox credentials come from the Plaid dashboard. `SMTP_URL` and `SMTP_FROM` are optional but must be set together.

`PLAID_E2E_PROVIDER=deterministic` is optional and is rejected unless Plaid is in Sandbox, `APP_URL` is loopback, and Vercel is not production. It is a toggle, not an addition: when it is set the deterministic adapter wins and real Plaid credentials are never used. Comment it out to reach live Sandbox; set it to run the deterministic Playwright journeys.

Real Sandbox credentials are provisioned as of 2026-08-12. OAuth institutions cannot be linked from a local HTTP origin because Plaid only accepts redirect URIs registered in the dashboard, and localhost cannot be registered; `oauthRedirectUri()` omits the field for non-HTTPS origins.

### 3. Database Setup

```powershell
pnpm db:start
pnpm db:reset
```

### 4. Verify Setup

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
pnpm build
pnpm smoke:plaid
```

`pnpm smoke:plaid` exercises every live Plaid call against Sandbox and refuses to run unless `PLAID_ENV=sandbox`. Run it after changing Plaid request construction or rotating credentials; the deterministic provider cannot detect live contract drift. It is the runnable counterpart of [`docs/production-smoke-checklist.md`](../docs/production-smoke-checklist.md), whose numbered steps it mirrors; the checklist is what you follow by hand before a Production or Trial cutover.

## Quick Start

- Script: `dev-start.ps1` (local and gitignored)
- Database/API: `pnpm db:start` (`http://127.0.0.1:55321`, PostgreSQL `127.0.0.1:55322`)
- App: `pnpm dev --hostname 127.0.0.1 --port 3100` (`http://127.0.0.1:3100`)
- The script starts Supabase first, launches Next, polls the app URL, prints status, and waits until interrupted.

## Stop

Run `dev-stop.ps1` or `pnpm db:stop`. Stop the foreground Next process with Ctrl+C.

## E2E Environment

- **Harness:** playwright
- **Command (`e2eCommand`):** `npm run test:e2e`
- **Specs dir (`e2eTestsDir`):** `e2e/`
- **Artifacts dir (`e2eArtifactsDir`):** `test-results/` and `playwright-report/`

### What the command sets up and tears down

Playwright starts the Next application on port 3100 through its `webServer` configuration and tears it down after the suite. Supabase must already be running and `.env.local` (or the command environment) must point at it. Auth/Plaid journeys skip when their named fixture credentials are absent. GH-4 deterministic Plaid journeys require `PLAID_E2E_PROVIDER=deterministic`, Sandbox, loopback `APP_URL`, and active-member `E2E_PLAID_MEMBER_EMAIL` / `E2E_PLAID_MEMBER_PASSWORD` credentials.

### Fixtures and `E2E_REQUIRED_FIXTURES`

Every `E2E_*` gate resolves through `e2e/support/fixtures.ts`; no spec reads the environment directly. Each fixture family declares the variables it needs and any precondition. Most historical fallback chains are preserved there — `categories`, for example, still falls back to `E2E_PLAID_MEMBER_PASSWORD` — but `dashboard`, `manual-entries`, and `plaid-connection` deliberately no longer fall back. They need financial data or a linked Item that a seeded identity does not supply, and with the fallback in place a seeded run marked them "provisioned" and then failed. A family claiming to be provisioned when its specs cannot pass is the same false confidence as a silent skip.

An unprovisioned family skips by default, which is why a green run is not by itself evidence of coverage. `E2E_REQUIRED_FIXTURES` is the opt-in that makes absence loud: list families comma-separated (or `all`), and any listed family that is not provisioned **fails** the run naming the exact missing variables, instead of skipping. The end-of-run `globalTeardown` prints the full inventory — family, provisioned, required — and re-asserts the requirement so a family swallowed by an outer gate still fails.

### Seeding an owner

```powershell
pnpm seed:e2e
```

`pnpm db:reset` and `pnpm test:db` both end with a database holding no `auth.users` rows, and the application is invite-only, so no browser journey can sign in until an owner exists. `pnpm seed:e2e` creates one active owner and prints (or, under CI, exports to `$GITHUB_ENV`) the credentials that provision the `plaid`, `auth-owner`, and `categories` families. It reads the process environment first and falls back to `.env.local`, is idempotent, and refuses any non-loopback Supabase URL so it can never mint an owner in a hosted project. It seeds an identity, not financial data.

### What CI runs

CI seeds an owner after `pnpm test:db`, then runs Playwright twice. `e2e/route-loading.spec.ts` runs first against the already-built `next start` server with `E2E_REQUIRED_FIXTURES=auth-owner`, because its contract depends on production-only automatic Link prefetching. The remaining suite runs with `E2E_EXCLUDE_ROUTE_LOADING=1`, `E2E_REQUIRED_FIXTURES=plaid,auth-owner,categories,budgets-service-cleanup`, and `E2E_SERVER_MODE=dev`. Development mode is required because the deterministic Plaid journeys are unreachable against a production build: the client guard in `src/components/plaid/plaid-link-flow.tsx` is a compile-time `NODE_ENV !== "production"` check. This split weakens no product control — `pnpm build` proves the production build compiles, and `getPlaidProvider()` still requires Sandbox on a loopback origin off Vercel.

Note that `PLAID_E2E_PROVIDER` and `PLAID_ENV` must reach the **Playwright process**, not just the Next server. Next loads `.env.local` for the server, but the test runner does not, so a local run needs them exported before the fixture gate will see them.

### Last verified

2026-08-11 — Windows/PowerShell, Docker 29.6, local Supabase migration replay, Next production build, and Playwright desktop/mobile app startup verified.

## Deploying a Change

A Vercel deployment ships application code only. Any change under `supabase/migrations/` must be applied separately with `pnpm exec supabase db push --linked`, or a SQL-only fix appears to have no effect in production. Confirm what the hosted database actually holds before diagnosing further, for example:

```sql
select prosrc like '%some removed text%' as still_old
from pg_proc where proname = 'commit_plaid_sync';
```

## Troubleshooting

### `supabase` is not recognized

Use the project-pinned command (`pnpm exec supabase`) or the package scripts instead of a global CLI.

### App environment validation fails

Ensure all values from `.env.example` are present. Only the two `NEXT_PUBLIC_*` values may enter the browser; Plaid, service-role, encryption, and cron values are server-only.

### `pnpm format:check` reports every file on Windows

`core.autocrlf=true` writes CRLF to the working tree while Prettier defaults to LF, so all files are flagged even on a clean checkout. CI is unaffected because Linux checks out LF. Verify individual files with `pnpm exec prettier --check --end-of-line auto <paths>` until the `.gitattributes` fix lands under GH-15. Do not run `prettier --write` across the repository to silence it; that rewrites every file.

### `vitest` is not recognized

`node_modules/.bin` can end up empty after an interrupted install. `pnpm install --frozen-lockfile` may report success without repairing it; remove `node_modules` and reinstall.

## Last Verified

2026-08-14 — Windows/PowerShell; 486 Vitest checks across 47 files green on `main` at `8f6febf`. Lint, typecheck, production build, and 10/10 live Plaid Sandbox smoke checks last verified 2026-08-13.

Verification is memory-bound on this workstation rather than slow. `next dev`, `next build`, and Vitest all hit `FATAL ERROR: Zone Allocation failed` under concurrency with roughly 2 GB free, which reads as a test failure but is not one. Check free memory before blaming a suite, and run the browser suite as `CI=1 pnpm exec playwright test --workers=1` so Playwright drives the much lighter `pnpm start`.
