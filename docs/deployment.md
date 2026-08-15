# Deployment guide

Budget App v1 has one supported production topology: application code on **Vercel**, a **user-owned hosted Supabase project**, and a **user-owned Plaid account**. The local Supabase Docker stack is a development tool only. A bundled or self-hosted Supabase Docker distribution is not supported in v1.

Vendor plans, quotas, retention, regions, and prices change. Review the current Vercel, Supabase, and Plaid terms before deployment; this project does not promise a particular price, free allowance, uptime, or backup retention.

## What you need

- A GitHub account and a fork or clone of this repository.
- Node.js 22, Corepack, and pnpm 8.14.
- Vercel, hosted Supabase, and Plaid accounts that you administer.
- A production hostname you control and an SMTP provider for reliable password recovery.
- Plaid **Sandbox** for development. Apply for **Trial or Production** access well before linking a real institution.

The installation is for one household and one workspace. Canada, Canadian institutions, and CAD are the only supported region/currency. The Plaid product is **Transactions only**: Budget App cannot initiate transfers, payments, or any financial transaction.

## 1. Create the hosted Supabase project

1. In the Supabase dashboard, create a new hosted project and protect its organization and database password with appropriate account security.
2. From **Project Settings → API**, record the Project URL, publishable key, and service-role key. The URL and publishable key are public identifiers; the service-role key is a server-only secret that bypasses row-level security.
3. Install dependencies and authenticate the repository-pinned CLI:

   ```bash
   corepack enable
   pnpm install --frozen-lockfile
   pnpm exec supabase login
   pnpm exec supabase link --project-ref <your-project-ref>
   pnpm exec supabase db push --linked
   ```

4. Review the migration output. Do not expose schemas other than those already declared by the project configuration.

A Vercel deployment does **not** apply SQL migrations. Application code and database schema are separate releases. Run `pnpm exec supabase db push --linked` whenever `supabase/migrations/` changes, and do so in the order specified by the release checklist.

### Auth URLs and the application session

In **Supabase → Authentication → URL Configuration**:

- Set **Site URL** to the exact HTTPS deployment origin, such as `https://budget.example.com`.
- Add `https://budget.example.com/auth/confirm` to the allowed redirect URLs. Add the corresponding Vercel preview origin only when a trusted preview genuinely needs auth; remove it afterwards.
- Keep public sign-up disabled. Budget App creates the first owner through `/setup`; all later members require an owner-generated invite link.

Supabase access-token lifetime is not the whole session policy. Budget App separately enforces an absolute **30-day application session boundary** using a signed, HttpOnly session-start cookie. After 30 days the member must sign in again; extending Supabase JWT lifetime does not remove this boundary.

Configure **custom SMTP** in Supabase Auth before relying on password recovery. The built-in/default mail service is unsuitable for a household production installation and can be rate-limited. Set a sender you control, verify recovery from `/forgot-password`, and keep any optional application `SMTP_URL`/`SMTP_FROM` pair consistent with your mail provider.

### Backups are an operator responsibility

The infrastructure administrator owns database backup and restore. Enable an appropriate hosted-Supabase backup/PITR plan, understand its retention, and periodically test a restore into an isolated project. An app rollback does not roll back the database. Never test a restore over the live project, and never assume a provider snapshot includes secrets stored outside PostgreSQL.

## 2. Configure Plaid

### Local development: Sandbox

Create a Plaid application, enable the **Transactions** product, select **Canada** as the supported country, and use `PLAID_ENV=sandbox` with Sandbox credentials in `.env.local`. Sandbox is synthetic and does not prove a real institution's OAuth flow. `pnpm smoke:plaid` exercises the live Sandbox API and deliberately refuses Trial/Production.

`PLAID_E2E_PROVIDER=deterministic` is only for local deterministic browser tests. It replaces real Plaid behavior and is rejected outside Sandbox on a loopback origin.

### Trial or Production

Request Plaid Trial/Production activation and Canada Transactions access in your own Plaid account. Budget App requests Transactions only; do not add Auth, Transfer, Payment Initiation, or another money-movement product.

In the Plaid dashboard:

1. Register the public webhook URL exactly as `https://budget.example.com/api/plaid/webhook` and set the same value as `PLAID_WEBHOOK_URL`.
2. **Before an HTTPS `APP_URL` goes live**, register the deployment origin's exact `/accounts` URL—`https://budget.example.com/accounts`—as an allowed OAuth redirect URI.
3. Confirm the client ID and environment-specific secret belong to the intended Plaid environment.

The OAuth redirect ordering is strict: once `APP_URL` is HTTPS, `/link/token/create` sends `<APP_URL>/accounts` as `redirect_uri`. If that exact URL was not registered first, link-token creation fails with Plaid `INVALID_FIELD`. Local HTTP/localhost origins cannot be registered for Plaid OAuth, so local HTTP can test non-OAuth Sandbox institutions but **cannot link OAuth institutions**.

## 3. Configure Vercel

1. Import the GitHub repository into a Vercel project.
2. Use the repository defaults (`pnpm build`); no custom framework adapter is required.
3. Configure the Vercel environment variables listed below; all server-only values belong in Vercel secrets, never source control.
4. Add every application variable below to the Production environment. Add them to Preview only if that preview is trusted and has isolated vendor resources.

| Variable                               | Exposure                                | Production value/purpose                         |
| -------------------------------------- | --------------------------------------- | ------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | Public/browser                          | Hosted Supabase project URL                      |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public/browser                          | Hosted Supabase publishable key                  |
| `SUPABASE_SERVICE_ROLE_KEY`            | **Server-only secret**                  | Privileged database operations; bypasses RLS     |
| `APP_URL`                              | Server-only config                      | Exact canonical HTTPS origin, no trailing slash  |
| `PLAID_CLIENT_ID`                      | Server-only                             | User-owned Plaid application ID                  |
| `PLAID_SECRET`                         | **Server-only secret**                  | Environment-specific Plaid secret                |
| `PLAID_ENV`                            | Server-only config                      | `trial` or `production` for real institutions    |
| `PLAID_WEBHOOK_URL`                    | Server-only config                      | Public `/api/plaid/webhook` URL                  |
| `PLAID_TOKEN_ENCRYPTION_KEY`           | **Server-only secret**                  | Independent random value, at least 32 characters |
| `CRON_SECRET`                          | **Server-only secret**                  | A different random value, at least 32 characters |
| `SMTP_URL`, `SMTP_FROM`                | **Optional server-only secrets/config** | Both or neither; lifecycle notification mail     |

Generate secrets with a cryptographically secure password manager or secret generator. Never copy example text into production, paste a secret into an issue, commit `.env.local`, or prefix a secret with `NEXT_PUBLIC_`. Keep `PLAID_TOKEN_ENCRYPTION_KEY` stable: replacing it without a controlled migration makes existing stored Plaid tokens unreadable and requires affected Items to be relinked.

Do not set `PLAID_E2E_PROVIDER` or test fixture variables in Vercel.

5. Deploy the application. If you use a custom domain, update `APP_URL`, Supabase Site/redirect URLs, Plaid OAuth redirect, and `PLAID_WEBHOOK_URL` together, then redeploy.

### Nightly sync cron

[`vercel.json`](../vercel.json) schedules `/api/internal/plaid-sync` nightly at `07:17 UTC`. Vercel invokes the route with `Authorization: Bearer <CRON_SECRET>`. `CRON_SECRET` is a distinct, dedicated credential: it must not equal the Plaid secret, encryption key, Supabase key, or a user password. A browser request without that bearer secret is rejected.

The webhook is the prompt update path and the nightly cron is a repair/safety sweep; both converge on the same idempotent sync logic. Check Vercel cron availability and limits for the plan you selected.

## 4. Claim the first owner

1. Visit `https://budget.example.com/setup` immediately after the first successful deployment.
2. If no workspace exists, create the workspace and first owner credentials. That account becomes the only owner.
3. Sign in and open **Settings → Members**. Confirm the owner identity, then create expiring invite links for other members and share them privately with the intended address.
4. Verify password recovery through the configured SMTP path before connecting a bank.

Setup closes once the workspace is claimed. There is no public registration path; later users join only through a valid, unexpired, unrevoked invite.

## 5. Release verification

Before connecting household data:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm db:start
pnpm test:db
pnpm build
pnpm test:e2e
pnpm smoke:plaid
```

Then perform the numbered [Production / Trial smoke checklist](./production-smoke-checklist.md) against a disposable real-institution Item. In particular, verify Canada/Transactions entitlement, OAuth return, webhook delivery, Family/Personal isolation, CSV export, and provider revocation. Do not announce a release if a privacy boundary or revocation check fails.

See [Operations](./operations.md) for backups, day-two monitoring, lifecycle actions, troubleshooting, and rollback.
