# Tech Context

## Repository Structure

- Type: single-repo
- Repository: `budget-app`, containing the web application, database migrations, and tests.

## Language & Runtime

- Language: TypeScript 5 and SQL migrations.
- Runtime: Node.js 22.

## Frameworks

- Frontend/backend: Next.js 16.3 App Router with React 19 and Tailwind CSS 4.
- Data/auth: Supabase PostgreSQL and `@supabase/ssr`.

## Testing

- Unit/component tests: Vitest 4, Testing Library, jsdom; `src/**/*.test.{ts,tsx}`.
- E2E tests: Playwright 1.62; `e2e/*.spec.ts`, desktop and mobile Chromium.
- Quality commands: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`.

## Database

- Hosted Supabase PostgreSQL with versioned SQL under `supabase/migrations/`.
- No ORM. Authorization is centered on PostgreSQL row-level security.
- Local database commands: `pnpm db:start`, `pnpm test:db`, and `pnpm db:stop`; pgTAP tests live under `supabase/tests/database/`.

## Build & Deploy

- Package manager: pnpm 8.14.
- Build command: `pnpm build`.
- Deploy target: Vercel plus a user-owned hosted Supabase project.

## Integrations

- Project management: GitHub Issues (`patrickxunuo/budget-app`).
- Bank data: Plaid Transactions, read-only.

## Key Dependencies

- `@supabase/supabase-js` and `@supabase/ssr`: browser, SSR, and privileged server clients.
- `plaid`: server-only Transactions API client.
- `zod`: public and server environment validation.
