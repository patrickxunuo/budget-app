# Budget App

Budget App is an open-source, self-hosted family budgeting application for Canadian households. It will use Plaid for read-only bank data, Supabase for authentication and storage, and Vercel for the supported web deployment path.

The project is under active development. The current implementation establishes the Next.js application foundation from [issue #1](https://github.com/patrickxunuo/budget-app/issues/1); bank linking and financial dashboards are not implemented yet.

## Product boundaries

- Canada and CAD only in v1
- Chequing, savings, and credit-card accounts only
- Plaid Transactions access only; Budget App cannot initiate transfers or payments
- One self-hosted family workspace with separate Family and Personal data scopes
- Vercel plus a user-owned hosted Supabase project is the supported deployment path
- Installable PWA support is planned in [issue #13](https://github.com/patrickxunuo/budget-app/issues/13)

## Technology

- Next.js App Router with TypeScript and Tailwind CSS
- Supabase browser, SSR, and server-only administrative client boundaries
- Plaid Node SDK isolated in a server-only module
- Zod environment validation
- Vitest and Testing Library
- Playwright E2E coverage for desktop and mobile Chromium
- ESLint, Prettier, and GitHub Actions

## Local development

Requirements:

- Node.js 22
- pnpm 8.14 or a compatible version managed through Corepack
- A Supabase project
- Plaid Sandbox credentials

Install dependencies and create your local environment file:

```bash
pnpm install
cp .env.example .env.local
```

Fill in `.env.local`, then start the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The `/dashboard` route currently demonstrates the future authenticated application shell; authentication enforcement arrives in issue #3.

## Environment boundary

Only these values may enter the browser bundle:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Plaid credentials, the Supabase service-role key, encryption material, and the cron secret are validated only inside modules marked `server-only`. Never prefix a secret with `NEXT_PUBLIC_` and never commit `.env.local`.

See [.env.example](./.env.example) for the complete configuration contract. Production values will be documented in depth by [issue #15](https://github.com/patrickxunuo/budget-app/issues/15).

## Quality checks

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

The Playwright command starts Budget App automatically on port 3100. Install
its local Chromium runtime once with `pnpm exec playwright install chromium`.
The suite captures landing-page and dashboard PNGs for both desktop and mobile
projects and attaches them to the generated `playwright-report`.
GitHub Actions runs the same checks against the production build for every push
and pull request, retaining Playwright diagnostics when E2E tests fail.

## Project structure

```text
src/
  app/                 Routes, layouts, and framework error boundaries
  components/          Shared presentation components
  lib/env/             Public and server environment contracts
  lib/plaid/           Server-only Plaid client
  lib/supabase/        Browser, SSR, and privileged server clients
  test/                Shared test setup
e2e/                   Desktop and mobile browser journeys
```

## Roadmap

The complete v1 backlog is tracked in the [v1.0 milestone](https://github.com/patrickxunuo/budget-app/milestone/1). Native dependency links in GitHub describe the implementation order.

## License

Budget App is available under the [MIT License](./LICENSE).
