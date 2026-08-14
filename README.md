<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
  <img src="docs/logo.svg" alt="Budget App" width="96" height="96">
</picture>

# Budget App

**A self-hosted, read-only family budgeting app for Canadian households.**

Link your Canadian bank accounts through Plaid, keep shared household spending and private personal spending strictly separate, and own every byte of it on infrastructure you control.

[![CI](https://github.com/patrickxunuo/budget-app/actions/workflows/ci.yml/badge.svg)](https://github.com/patrickxunuo/budget-app/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js_16-000000?logo=next.js&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript_5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![Plaid](https://img.shields.io/badge/Plaid-Transactions_only-0A85EA)](https://plaid.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

</div>

---

## Why this exists

Most budgeting apps ask you to hand your bank data to a company whose business model is your bank data. Budget App is the other option: you run it, on your own Vercel and Supabase accounts, with your own Plaid credentials. Nobody else has a copy.

It is built around one idea most shared-finance tools get wrong — **a household is not one wallet**. Family groceries and someone's private spending are different things, and the second kind should stay private even from the person who set the workspace up.

## What it can and cannot do

|                                          |                                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 🇨🇦 **Canada and CAD only**               | Canadian institutions, Canadian dollars, Canadian calendar and timezone semantics                                                           |
| 🔒 **Read-only, always**                 | Plaid **Transactions** access only. The app has no ability to move money — not a permission it declines to use, a permission it never holds |
| 👨‍👩‍👧 **Family and Personal, never merged** | Two scopes with a hard database boundary. There is deliberately no "combined" view                                                          |
| 🏦 **Chequing, savings, credit cards**   | Other account types are shown during linking with a reason they were excluded                                                               |
| 🏠 **One self-hosted household**         | Not multi-tenant SaaS. One family, one workspace, your infrastructure                                                                       |

## Features

**Banking**

- Read-only Plaid Link for Canadian institutions, with per-account Family/Personal placement at link time
- Idempotent cursor-based transaction sync, safe to retry and re-run
- Signed webhooks, a nightly cron sweep, and a manual refresh — all converging on the same durable state
- Connection health, consent-expiry warnings, update-mode repair, and account re-selection
- Disconnect with either _keep history_ or _delete data_, always revoking access at Plaid

**Money**

- Cent-exact CAD accounting — no floating-point drift in balances or totals
- Automatic classification of income, spending, transfers, and refunds, with per-transaction overrides
- Pending-to-posted reconciliation that cannot double-count, regardless of the order Plaid sends things
- A manual cash ledger for what never touches a bank account
- Scoped categories and merchant rules that apply to existing _and_ future transactions

**Insight**

- Family and Personal dashboards: cash flow, category spend, budget progress, cached balances with freshness
- Monthly category budgets with effective-dated history, so editing this month never rewrites last month
- Day, week, month, and custom ranges in your configured Canadian timezone
- CSV export of exactly what you can see, hardened against spreadsheet formula injection

**Privacy and safety**

- Invite-only membership. No public sign-up, ever
- PostgreSQL row-level security as the authorization boundary — not application `if` statements
- Plaid access tokens encrypted at rest with AES-256-GCM
- Recent-password confirmation gating every destructive action
- Audited, retryable account and workspace deletion that revokes Plaid access first

## Security model

Worth stating explicitly, because self-hosting a finance app deserves it.

- **Only two values ever reach the browser**: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Plaid credentials, the service-role key, token-encryption material, and the cron secret are validated inside modules marked `server-only` and cannot be imported into client code.
- **Authorization lives in the database.** Row-level security decides who sees what, so a mistake in a route handler cannot leak another member's Personal records. The Family owner has no privileged read path into anyone's private data.
- **Errors are sanitized outward.** API responses never carry provider tokens, internal identifiers, or raw provider errors; causes are logged server-side only.
- **Destructive actions fail closed.** Deletion revokes Plaid access before removing local data, and reports anything it could not confirm rather than silently succeeding.

Full database backup and restore is the responsibility of whoever administers the Supabase project. The app does not attempt it.

## Architecture

```
src/
├── app/
│   ├── (app)/          # Authenticated shell: dashboard, transactions, budgets, accounts
│   ├── (auth)/         # Invite-only sign-in, setup, recovery
│   └── api/            # Route handlers: plaid, categories, transactions, internal cron
├── components/         # UI, grouped by domain
└── lib/
    ├── auth/           # Membership, session policy, data lifecycle
    ├── env/            # Zod-validated client and server environment boundaries
    ├── plaid/          # Server-only provider, linking, sync, connection management
    ├── transactions/   # Cent-exact CAD accounting engine
    └── supabase/       # Browser, SSR, and privileged admin clients

supabase/
├── migrations/         # Versioned SQL; RLS and RPCs live here
└── tests/database/     # pgTAP policy and invariant coverage

scripts/                # Operational tooling, e.g. the live Plaid contract smoke test
```

## Quick start

**Prerequisites:** Node.js 22 · pnpm 8.14 (via Corepack) · Docker · a [Plaid Sandbox](https://dashboard.plaid.com/) account

```bash
git clone https://github.com/patrickxunuo/budget-app.git
cd budget-app
pnpm install --frozen-lockfile

cp .env.example .env.local     # then fill it in — see below
pnpm db:start                  # local Supabase in Docker
pnpm db:reset                  # apply migrations

pnpm dev
```

Open <http://localhost:3000>. The first visitor claims the workspace as owner; everyone else joins by invitation.

Local Supabase prints its own URL and keys on `pnpm db:start` — use those for the three Supabase variables. Plaid Sandbox credentials come from the Plaid dashboard.

## Configuration

| Variable                               | Required | Notes                                                                                     |
| -------------------------------------- | :------: | ----------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             |    ✅    | Public. Enters the browser bundle                                                         |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |    ✅    | Public. Enters the browser bundle                                                         |
| `SUPABASE_SERVICE_ROLE_KEY`            |    ✅    | **Secret.** Bypasses RLS — server only                                                    |
| `PLAID_CLIENT_ID`                      |    ✅    | From the Plaid dashboard                                                                  |
| `PLAID_SECRET`                         |    ✅    | **Secret.** Per-environment                                                               |
| `PLAID_ENV`                            |    ✅    | `sandbox`, `trial`, or `production`                                                       |
| `PLAID_WEBHOOK_URL`                    |    ✅    | Must be publicly reachable to receive updates                                             |
| `PLAID_TOKEN_ENCRYPTION_KEY`           |    ✅    | **Secret.** ≥32 chars. Rotating it makes stored tokens undecryptable                      |
| `CRON_SECRET`                          |    ✅    | **Secret.** ≥32 chars, distinct from the above                                            |
| `APP_URL`                              |    ✅    | Canonical origin for redirects                                                            |
| `SMTP_URL` / `SMTP_FROM`               |    —     | Optional, but both or neither                                                             |
| `PLAID_E2E_PROVIDER`                   |    —     | `deterministic` for local E2E. A **toggle**: when set, real Plaid credentials are ignored |

> Never prefix a secret with `NEXT_PUBLIC_`, and never commit `.env.local`.

## Deployment

The supported path is **Vercel + a hosted Supabase project + your own Plaid account**.

1. Create a Supabase project and apply migrations: `pnpm exec supabase link --project-ref <ref> && pnpm exec supabase db push`
2. Configure Supabase auth redirect URLs, session policy, and custom SMTP for password recovery
3. Deploy to Vercel and set every variable above, using an HTTPS `APP_URL`
4. Register `https://<your-domain>/accounts` as an allowed **OAuth redirect URI** in the Plaid dashboard, and point the webhook at `https://<your-domain>/api/plaid/webhook`
5. The nightly sync cron in [`vercel.json`](./vercel.json) authenticates with `CRON_SECRET`

> [!IMPORTANT]
> **Migrations do not ship with a Vercel deploy.** Application code and database schema deploy separately. After any change under `supabase/migrations/`, run `pnpm exec supabase db push` — otherwise a SQL fix appears to have no effect in production.

Going live with real bank data additionally requires Plaid **Trial or Production** access, which is a review process. Start it early.

## Testing

```bash
pnpm test          # Vitest unit and component tests
pnpm test:db       # pgTAP: RLS policies and database invariants
pnpm test:e2e      # Playwright, desktop and mobile Chromium
pnpm smoke:plaid   # Live Plaid Sandbox contract check (Sandbox-only, refuses otherwise)
pnpm lint && pnpm typecheck && pnpm build
```

`pnpm smoke:plaid` exists because mocks cannot catch provider contract drift. It exercises every live Plaid call the app makes — link tokens, item exchange, institution lookup, accounts, transaction sync, update mode, login repair, and item removal — against real Sandbox. Run it after touching Plaid request construction or rotating credentials.

Before a Trial or Production release, work through the [production smoke checklist](./docs/production-smoke-checklist.md). It is the numbered manual pass against a real Canadian institution that Sandbox cannot stand in for.

## Roadmap

- [x] Invite-only family authentication and membership
- [x] Supabase schema with row-level security
- [x] Read-only Canadian Plaid linking and idempotent sync
- [x] Cent-exact accounting, categories, and merchant rules
- [x] Manual cash ledger, dashboards, and monthly budgets
- [x] Connection lifecycle, CSV export, and data deletion
- [ ] [#13](https://github.com/patrickxunuo/budget-app/issues/13) Installable, accessible mobile-first PWA
- [ ] [#14](https://github.com/patrickxunuo/budget-app/issues/14) Automated testing and security hardening
- [ ] [#15](https://github.com/patrickxunuo/budget-app/issues/15) Deployment and operations documentation

See [open issues](https://github.com/patrickxunuo/budget-app/issues) for the full picture.

## Contributing

Contributions are welcome. Please open an issue before starting substantial work.

- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`)
- Everything green before opening a PR: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`, `pnpm build`
- New database rules need pgTAP coverage; new domain logic needs unit coverage
- Never commit secrets, and never widen the `server-only` boundary

Found a security issue? Please report it privately rather than opening a public issue.

## License

[MIT](./LICENSE) — do what you like, no warranty.

---

<div align="center">
<sub>Budget App cannot move your money. It can only read what your bank already knows.</sub>
</div>
