# Progress

## Current Sprint / Focus

GH-8 Manual/Cash ledger is review-ready.

## Log

- 2026-08-12T20:58Z [READY] GH-8 adds private Personal and collaborative audited Family Manual/Cash entries, validated RPC-only CRUD, refund/category accounting, complete paged summaries and filtered CSV, and a responsive ledger workflow; 153 Vitest checks, 312 pgTAP assertions, lint/typecheck/build, 14 runnable browser journeys, and independent review are green.

- 2026-08-12T20:00Z [PLANNED] GH-8 approved: add an audited Manual/Cash data boundary, validated Personal/Family CRUD APIs, unified accounting/filter/summary/CSV semantics, and a responsive create/edit/delete ledger workflow with database, unit, API, component, and Playwright coverage.

- 2026-08-12T19:08Z [READY] GH-7 scoped categories and merchant rules are review-ready with immutable Plaid source facts, privacy-domain category selection, audited manual/rule attribution, exact opaque merchant identity, RPC-only rule mutations, responsive Categories/Transactions workflows, 121 Vitest checks, 292 pgTAP assertions, lint/typecheck/build, and independent review green.

- 2026-08-12T17:48Z [PLANNED] GH-7 approved: seed Plaid categories, add scoped custom categories and durable transaction overrides, apply audited merchant rules to existing/future imports with preview, and ship responsive Categories/Transactions workflows with database, unit, API, and Playwright coverage.

- 2026-08-12T17:35Z [READY] GH-6 shipped a cent-safe CAD accounting domain, metadata-only kind/rule overrides, exact Plaid income/transfer/refund classification, pending reconciliation, Canadian calendar ranges, and category summaries; 105 Vitest checks, 260 pgTAP assertions, lint/typecheck/build, and independent review are green.

- 2026-08-12T00:45Z [PLANNED] GH-6 approved: metadata-only classification overrides/rule attribution plus a pure CAD accounting engine for signs, transaction kinds, pending reconciliation, exclusions, Canadian calendar ranges, and summary/category totals with Vitest and pgTAP coverage.

- 2026-08-12T00:30Z [READY] GH-5 atomic cursor-based Plaid synchronization implemented with signed webhooks, nightly/member recovery, durable sanitized retry/repair state, database-backed freshness UI, and order-independent pending-to-posted reconciliation; 91 Vitest checks, 246 pgTAP assertions, lint/typecheck/build, 14 runnable browser journeys, and independent review are green.

- 2026-08-12T00:00Z [PLANNED] GH-5 approved: atomic cursor-based Plaid sync, pending-to-posted reconciliation, authenticated webhook/nightly/member entry points, retry and freshness state, database-backed Accounts status, and unit/pgTAP/Playwright verification.

<!-- Newest entries first. Format: - YYYY-MM-DDTHH:MMZ [status] feature-name — notes -->

- 2026-08-11T23:20Z [PR] GH-4 read-only Canadian Plaid linking shipped in commit `0acefa9` and [PR #18](https://github.com/patrickxunuo/budget-app/pull/18) with server-authenticated institution identity, AES-256-GCM token storage, atomic Personal/Family activation, serialized duplicate enforcement, retryable initial sync, and an accessible Accounts dossier; lint, typecheck, build, 49 Vitest checks, 217 pgTAP assertions, 28 browser journeys, and independent review are green.
- 2026-08-11T22:12Z [PLANNED] GH-4 approved: secure Canadian read-only Plaid Link, encrypted pending review, Personal-by-default mixed visibility activation, duplicate override, initial import, polished Accounts UI, and unit/pgTAP/Playwright verification.

- 2026-08-11T22:35Z [PR] GH-3 invite-only auth, recovery, session expiry, invitations, guarded membership/deletion flows, and durable Auth cleanup shipped in commit `01c4f25` and [PR #17](https://github.com/patrickxunuo/budget-app/pull/17); 17 unit/component tests, 191 pgTAP assertions, lint/type/build, 14 browser tests, and independent review green. CI now retains its local Supabase stack and exports generated runtime credentials through the browser job.
- 2026-08-11T19:12Z [READY] GH-2 Supabase family schema and privacy boundary implemented; clean migration replay, 157 pgTAP assertions, lint/type/unit/build, and independent review green.
- 2026-08-11T17:43Z [INIT] Memory bank initialized from the GH-1 application foundation and GH-2 requirements.
- 2026-08-11T16:40Z [SHIPPED] GH-1 Next.js foundation published to `main`; CI passed after generating Next route types before TypeScript checks.

## Planned

- Review and merge the GH-3 pull request.
- Provision live owner/member/invitation fixtures for the environment-gated browser journeys.
