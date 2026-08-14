# Security policy

Budget App stores household financial records and credentials for privileged vendor APIs. Please report vulnerabilities privately and avoid exposing member data while doing so.

## Supported versions

Security fixes are made on the current `main` branch and, when the repository publishes tagged releases, the latest release. Older commits, forks, modified deployments, and unsupported self-hosted Supabase/Docker distributions do not receive security fixes. Operators should update promptly after reviewing release notes and migration instructions.

This policy is not an uptime, response-time, or long-term-support guarantee.

## Report a vulnerability privately

**Do not open a public issue, discussion, or pull request.** Use GitHub's private vulnerability reporting flow:

[Open a private GitHub Security Advisory](https://github.com/patrickxunuo/budget-app/security/advisories/new)

Include only what is needed to reproduce safely:

- affected commit/version and deployment topology;
- impact and which Family/Personal or privileged boundary is involved;
- minimal reproduction steps or a proof of concept using synthetic data;
- sanitized request/response details and relevant logs;
- whether Plaid access, revocation, Supabase RLS, secrets, auth, exports, or service-worker caching is implicated;
- a safe contact method for follow-up.

Never send Plaid access tokens, bank credentials, real account/transaction data, Supabase service-role keys, encryption/cron secrets, database dumps, invitation/reset links, or raw unredacted production logs. If a secret is required to demonstrate impact, describe its type and arrange a safe exchange after maintainers respond.

## What to expect

Maintainers aim to acknowledge a complete private report within five business days, assess severity and reproduce it privately, then coordinate remediation and disclosure with the reporter. Timing depends on impact, complexity, and maintainer availability; these are response targets, not guarantees. Please allow a reasonable private remediation period before disclosure. We will credit reporters who want credit and whose report materially contributes to a fix.

For an active incident, do not wait for repository triage: the operator should restrict the deployment, revoke affected Plaid Items/credentials, rotate compromised secrets, and contact the relevant vendor. Preserve only redacted evidence.

## Security and trust boundary

Normal application authorization is enforced primarily by Supabase row-level security. Family records are shared with active workspace members; Personal records are isolated to their owner, including from the Family owner through normal application paths. Budget App requests Plaid Transactions read access and cannot initiate transfers, payments, or another financial transaction.

The infrastructure administrator is explicitly trusted. A person who controls the hosted Supabase project/service-role key can access the underlying database, and a person who controls Vercel can access deployment secrets or replace server code. Application RLS cannot protect against those administrators. Operators must minimize administrator access, require MFA, protect backups, and review vendor audit logs/access.

Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are intended for the browser. `SUPABASE_SERVICE_ROLE_KEY`, Plaid credentials, `PLAID_TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`, and SMTP credentials are server-only. Never prefix a secret with `NEXT_PUBLIC_`.

## Secret handling and rotation

- Store production secrets in Vercel/Supabase/Plaid secret controls, not the repository, issue tracker, browser storage, client bundle, or screenshots.
- Use independent, randomly generated credentials; in particular, `CRON_SECRET` must not be reused.
- Rotate a suspected Supabase service-role/Plaid/cron/SMTP credential at its source, update the deployment atomically, redeploy, and verify affected paths.
- `PLAID_TOKEN_ENCRYPTION_KEY` is different: existing stored Plaid tokens are encrypted with it. Replacing it without controlled re-encryption makes those tokens unreadable. If compromised, first revoke affected Items in Plaid, then follow a reviewed migration/relink plan; do not simply overwrite the value and declare rotation complete.
- Treat backups and exported CSV files as sensitive Personal data. Retention and verified deletion are the infrastructure administrator's responsibility.

## Out of scope and safe research

Do not access another person's data, run denial-of-service or social-engineering tests, test real bank credentials, degrade a household deployment, or retain data beyond what is needed for a report. Use a local installation, Plaid Sandbox, and synthetic fixtures. Findings that require a malicious trusted infrastructure administrator may still be useful hardening reports, but they are outside the normal application authorization guarantee and should be described as such.

Operational incidents and non-security bugs belong in GitHub Issues only after all data, secrets, provider identifiers, and raw errors have been removed. See [`docs/operations.md`](./docs/operations.md) for containment and recovery.
