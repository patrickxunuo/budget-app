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

Copy `.env.example` to the ignored `.env.local` and fill every value. Local Supabase URLs/keys come from `pnpm db:start`; Plaid Sandbox credentials come from the Plaid dashboard. `PLAID_E2E_PROVIDER=deterministic` is optional and is rejected unless Plaid is in Sandbox, `APP_URL` is loopback, and Vercel is not production.

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
```

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

### Last verified

2026-08-11 — Windows/PowerShell, Docker 29.6, local Supabase migration replay, Next production build, and Playwright desktop/mobile app startup verified.

## Troubleshooting

### `supabase` is not recognized

Use the project-pinned command (`pnpm exec supabase`) or the package scripts instead of a global CLI.

### App environment validation fails

Ensure all values from `.env.example` are present. Only the two `NEXT_PUBLIC_*` values may enter the browser; Plaid, service-role, encryption, and cron values are server-only.

## Last Verified

2026-08-11 — Windows/PowerShell.
