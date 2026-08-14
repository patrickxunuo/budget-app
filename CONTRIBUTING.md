# Contributing

Thanks for helping improve Budget App. The project handles household financial data, so privacy boundaries and reproducibility matter more than a quick patch.

## Before you start

- For a substantial change, open or comment on a GitHub issue to agree on scope.
- Do **not** use a public issue for a vulnerability; follow [`SECURITY.md`](./SECURITY.md).
- Never commit `.env.local`, Supabase service-role keys, Plaid credentials/tokens, cron/encryption secrets, invitation links, account data, screenshots containing household data, or unredacted logs.
- Keep the product boundary intact: Canada/CAD, Plaid Transactions read access only, no Combined privacy scope, and no financial transaction initiation.

## Local setup

Prerequisites: Node.js 22, Corepack/pnpm 8.14, Docker, and a Plaid Sandbox account for live provider-contract work.

```bash
git clone https://github.com/patrickxunuo/budget-app.git
cd budget-app
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm db:start
pnpm db:reset
pnpm dev
```

Fill `.env.local` with local Supabase values printed by `pnpm db:start` and safe Plaid Sandbox placeholders/credentials. `PLAID_E2E_PROVIDER=deterministic` is an optional local test toggle; never deploy it. The first local browser visit claims the owner. For repeatable browser fixtures after a database reset, run `pnpm seed:e2e`.

Stop the local database with `pnpm db:stop`.

## Make a focused change

- Branch from current `main`; keep commits focused and use Conventional Commit subjects such as `fix:`, `feat:`, `docs:`, `test:`, or `chore:`.
- Follow existing TypeScript, App Router, server-only, Zod, and database conventions. This repository uses its installed Next.js version; read the relevant guide under `node_modules/next/dist/docs/` before changing framework APIs.
- Add Vitest coverage for domain/component behavior, pgTAP for database/RLS rules, and Playwright coverage for user-visible journeys.
- New privileged paths must remain server-only. New financial reads require an explicit Family or Personal scope and matching RLS.
- Add migrations as new versioned SQL files. Never rewrite an already-deployed migration or hand-edit hosted production schema.
- Update documentation, `.env.example`, and the production smoke checklist when behavior or operations change.

Format only intentional files. Repository text is normalized to LF by `.gitattributes`.

## Test matrix

Run the checks relevant to the change while developing, then run the full pre-PR matrix:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm db:start
pnpm test:db
pnpm build
pnpm test:e2e
```

Additional commands:

```bash
pnpm test:watch       # focused Vitest development
pnpm test:coverage    # Vitest coverage
pnpm test:e2e:ui      # interactive Playwright investigation
pnpm test:e2e:report  # open the last HTML report
pnpm smoke:plaid      # live Plaid Sandbox contract; refuses other environments
```

`pnpm test:db` resets the local database. Seed a browser owner afterwards with `pnpm seed:e2e`. E2E fixture families skip when their named credentials/data are absent unless `E2E_REQUIRED_FIXTURES` requires them; read the inventory printed at suite end instead of treating green-with-skips as complete coverage.

Run `pnpm smoke:plaid` after changing Plaid request construction or rotating Sandbox credentials. Before a Trial/Production release, a trusted operator must also complete [`docs/production-smoke-checklist.md`](./docs/production-smoke-checklist.md) against a disposable real Canadian Item.

## Pull requests

1. Rebase/update from `main` without mixing unrelated cleanup into the branch.
2. Explain the user/operator outcome and important security/privacy decisions.
3. Link the issue and list exact verification commands/results, including skipped E2E fixture families.
4. Call out migrations, new/changed environment variables, rollout ordering, rollback limits, screenshots, and manual checks.
5. Include real screenshots only for public or synthetic/data-free surfaces. Redact nothing by painting over real household data; create safe fixtures instead.
6. Request review. Resolve critical feedback and keep CI green. Do not merge your own security-sensitive or migration change without independent review.

## Release checklist

The release owner verifies, in order:

- [ ] The PR is reviewed, CI is green, and `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`, `pnpm build`, and `pnpm test:e2e` were run with results recorded.
- [ ] Plaid changes passed `pnpm smoke:plaid`; Trial/Production changes passed the manual production smoke checklist.
- [ ] No secrets, member data, invitation/reset links, provider tokens, or raw errors appear in the diff, logs, screenshots, or artifacts.
- [ ] `.env.example`, deployment, operations, and security guidance match any changed configuration.
- [ ] Every new migration was reviewed and backed up, and `pnpm exec supabase link --project-ref <ref>` targets the intended hosted project.
- [ ] Database migrations are applied separately with `pnpm exec supabase db push --linked` at the documented point in the rollout; Vercel will not apply them.
- [ ] Vercel environment values and Supabase/Plaid URLs are configured without exposing server-only secrets; `CRON_SECRET` remains distinct.
- [ ] The production deployment is smoke-tested for sign-in/recovery, Family/Personal isolation, cron/webhook health, CSV export, and Plaid revocation.
- [ ] The operator has a tested rollback/recovery path. A Vercel rollback does not roll back migrations.
- [ ] Release notes state material behavior, migration/operations actions, and known limits without promising vendor prices or guarantees.

After release, monitor Vercel errors, cron execution, Plaid webhook delivery, connection health, and Supabase backup status.
