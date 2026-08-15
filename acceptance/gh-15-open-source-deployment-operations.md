# GH-15 Open-Source Deployment and Operations - Acceptance Criteria

## Description (client-readable)

Budget App publishes a complete, safe, reproducible path for deploying a new installation on Vercel with a user-owned hosted Supabase project and Plaid account. Operators and contributors can understand the product boundary, configure secrets, run and recover the service, report security issues privately, and verify a release without treating unsupported Docker distribution as a supported v1 path.

## Interface Contract

This is the shared agreement between the Test Writer and the Implementer. The deliverable is documentation and repository configuration; it does not add application endpoints, data models, or UI behavior.

### Documentation surfaces

| Path                           | Contract                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `README.md`                    | Product overview, Canada/CAD and read-only limits, public-page screenshots, architecture diagram, supported deployment statement, and links to all detailed guides |
| `docs/deployment.md`           | Blank hosted-Supabase + Plaid + Vercel deployment from prerequisites through first owner, including costs/limits caveat and secure configuration                   |
| `docs/operations.md`           | Day-two ownership, privacy, backup/restore, connection lifecycle, export/deletion, cron/webhook, and troubleshooting runbook                                       |
| `CONTRIBUTING.md`              | Local setup, test matrix, change expectations, pull-request process, and release checklist                                                                         |
| `SECURITY.md`                  | Private vulnerability reporting, supported-version policy, response expectations, secret handling, and trusted-host-administrator boundary                         |
| `.env.example`                 | Safe, non-secret placeholders and precise descriptions for every runtime variable                                                                                  |
| `.gitattributes`               | Exactly establishes `* text=auto eol=lf` as the repository-wide text normalization rule                                                                            |
| `docs/screenshots/landing.png` | Real screenshot of the public landing page containing no household financial data                                                                                  |
| `docs/screenshots/install.png` | Real screenshot of the public install guidance containing no household financial data                                                                              |

### Business rules

1. State that v1 supports Vercel plus a user-owned hosted Supabase project and user-owned Plaid account; a bundled/self-hosted Supabase Docker distribution is unsupported.
2. State Canada/CAD scope and that the app cannot initiate transfers, payments, or any financial transaction.
3. State that normal application authorization protects Personal data, while the infrastructure administrator is trusted and can access the underlying database/secrets.
4. Never publish, request, or embed real credentials. Secret examples are placeholders and secret variables are clearly marked server-only.
5. Document Supabase creation, CLI link/push migrations, site/redirect URLs, 30-day application session boundary, custom SMTP for password recovery, and backup/restore responsibility.
6. Document Plaid Sandbox locally, Trial/Production activation, Canada + Transactions-only product setup, webhook URL, and the exact production OAuth redirect rule: register the deployment origin's `/accounts` URL before an HTTPS `APP_URL` goes live or `/link/token/create` fails with `INVALID_FIELD`; local HTTP origins cannot link OAuth institutions.
7. Document Vercel environment setup and that the nightly `/api/internal/plaid-sync` cron is authenticated by a distinct `CRON_SECRET`; migrations deploy separately from application code.
8. Document first-owner claiming, invite links, Family versus Personal behavior, backup, repair, disconnect modes, CSV export, member removal, workspace deletion, and relevant irreversible effects.
9. Troubleshoot webhooks, stale data, Plaid Item/login errors, SMTP recovery, PWA install/update, and unsupported/non-CAD accounts.
10. Contribution and release guidance must run the repository's actual commands and direct security reports to a private GitHub Security Advisory rather than a public issue.
11. README links and screenshot references resolve to files in the repository; documentation must not promise unsupported guarantees or vendor pricing.

## Documentation Acceptance Tests

| ID      | Scenario                           | Expected result                                                                                                                                             |
| ------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOC-001 | Repository documentation inventory | Every contracted guide/config/image exists and README links to the guides and screenshots                                                                   |
| DOC-002 | Product and trust boundaries       | README/operations docs explicitly cover Canada/CAD, read-only/no financial transactions, Family/Personal isolation, and trusted infrastructure admin limits |
| DOC-003 | Supported deployment               | Deployment guide names Vercel, hosted Supabase, user-owned Plaid, and rejects bundled Supabase/Docker support for v1                                        |
| DOC-004 | Supabase setup                     | Deployment guide covers project creation, migrations, redirect URLs, 30-day application session, custom SMTP, backup/restore responsibility                 |
| DOC-005 | Plaid setup                        | Deployment guide covers Sandbox, Trial/Production, Transactions-only Canada setup, webhooks, and the exact HTTPS `/accounts` OAuth redirect failure mode    |
| DOC-006 | Vercel and cron                    | Deployment guide covers environment variables, separate migration deployment, nightly cron, and distinct `CRON_SECRET` authorization                        |
| DOC-007 | Runtime operations                 | Operations guide covers owner/invites, privacy, backup/restore, repair/disconnect, export, removal/deletion, and all ticket troubleshooting categories      |
| DOC-008 | Environment safety                 | `.env.example` contains every schema variable, no real secret, server/public distinction, and rotation warnings for encryption material                     |
| DOC-009 | Contribution/security/release      | Contributor and security files use actual commands, private advisory reporting, and a release checklist                                                     |
| DOC-010 | Line endings and local references  | `.gitattributes` contains `* text=auto eol=lf`; local Markdown links and screenshot assets referenced by README exist                                       |

## Test Status

- [x] DOC-001: PASS
- [x] DOC-002: PASS
- [x] DOC-003: PASS
- [x] DOC-004: PASS
- [x] DOC-005: PASS
- [x] DOC-006: PASS
- [x] DOC-007: PASS
- [x] DOC-008: PASS
- [x] DOC-009: PASS
- [x] DOC-010: PASS

## Verification

- Documentation contract: 10/10 passing.
- Full Vitest suite: 709/709 passing across 56 files.
- Lint, Next.js route type generation, TypeScript, and production build: passing.
- Screenshot assets: real public-route captures, visually checked to contain no household data.
