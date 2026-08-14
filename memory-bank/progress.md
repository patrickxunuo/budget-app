# Progress

## Current Sprint / Focus

Every issue through GH-12 is closed and the application is deployed to production at `piggy-budget-app.vercel.app` against a hosted Supabase project and Plaid Sandbox. A real Canadian institution links, activates, and syncs end to end. GH-13 is review-ready in PR #28; GH-14, GH-15, and GH-26 remain in the v1.0 milestone.

## Log

- 2026-08-13T23:55Z [READY] GH-13 ships the installable, accessible, mobile-first PWA in commit `7f9d51a` and [PR #28](https://github.com/patrickxunuo/budget-app/pull/28): a deny-by-default service worker that can only cache versioned static assets and a data-free `/offline` screen, cross-platform install guidance at `/install`, a mobile bottom bar with safe-area handling beside the existing desktop rail, System/Light/Dark themes applied before first paint, and a WCAG AA pass. 486 Vitest checks across 47 files, lint, typecheck, production build, and 36 runnable browser cases (96 fixture-gated) are green.
  - The palette contrast test found a real defect rather than confirming a belief: `bg-brand` with `text-white` is **2.05:1 in dark mode**, so every accent foreground moved to a contrast-gated `--on-accent`. `--line` was darkened to a true 3:1 control border and the old value kept as `--line-soft` for decorative hairlines.
  - Two review passes each found defects that no test could have caught. A PowerShell `Get-Content -Raw` round-trip silently re-encoded UTF-8 as the ANSI codepage and destroyed `→` and `·` in `src/app/page.tsx` — with data loss, since unmappable characters became `?`. Use `[System.IO.File]::ReadAllText`/`WriteAllText`, or an editor tool, never `Get-Content -Raw` without `-Encoding utf8`, on any file that might contain non-ASCII.
  - Declaring `metadata.icons` at all makes Next drop **every** file-convention icon (`accumulateMetadata` applies them only when `resolvedMetadata.icons` is unset). Adding an Apple icon silently unlinked `app/icon.svg`; both `icon.svg` and `favicon.ico` now have to be listed explicitly.
  - The branch was two commits behind `main` when it was cut, and the app-shell rewrite would have reverted `1211e33`'s pinned workspace header. Rebase before opening a PR that rewrites a file another commit just touched.
  - Verification is memory-bound on this workstation, not slow: `next dev`, `next build`, and Vitest all hit `FATAL ERROR: Zone Allocation failed` under concurrency with ~2 GB free. Four DOM-free suites moved to `// @vitest-environment node`, and the browser suite runs as `CI=1 pnpm exec playwright test --workers=1` so Playwright drives the much lighter `pnpm start`.

- 2026-08-13T22:40Z [SHIPPED] First real end-to-end production link against Tartan-Dominion Bank of Canada: exchange, account review, activation, and an initial sync of 175 transactions. Four defects had to be fixed to get there, none of which any automated test could see, because every Plaid path is covered only by mocks and the deterministic adapter.
  - `53138e4` GH-4 sent an unregistered `redirect_uri` on every link-token call.
  - `d6f948b` GH-5 rejected Plaid's explicit `"error": null` on TRANSACTIONS webhooks with a 400.
  - `91bca92` GH-4 threw on a balance not representable in cents, aborting the exchange for an entire Item because one ineligible RRSP reports four decimals. The same guard used an absolute tolerance that also rejected ordinary two-decimal balances such as 4523.19.
  - `21d6a03` GH-5 raised `unknown item account` for activity on accounts the member never linked, so any institution holding an unsupported or unselected account could never complete a sync.
  - Operational note: hosted database migrations are a separate deployment step. A Vercel deploy ships application code only; `supabase db push --linked` is required, and a SQL-only fix appears to do nothing until it runs.

- 2026-08-13T20:25Z [SHIPPED] GH-11 (`82e142a`, PR #25) and GH-12 (`9b056cf`, PR #27) are merged to `main`. Full local verification on Windows/PowerShell: 294 Vitest checks across 38 files, lint, Next route generation/typecheck, production build, and 10/10 live Plaid Sandbox smoke checks all green. Twelve migrations and ten pgTAP suites are in place.

- 2026-08-12T18:00Z [SHIPPED] Real Plaid Sandbox credentials provisioned and verified end to end. The first live run exposed GH-4 sending an unregistered `redirect_uri` on every `/link/token/create` call, which the deterministic E2E provider had masked; fixed in `53138e4` and covered by the committed contract smoke test `scripts/plaid-sandbox-smoke.mjs` (`pnpm smoke:plaid`, `c3201fa`).

- 2026-08-13T11:20Z [READY] GH-12 adds complete filter-faithful privacy-scoped CSV export, durable provider-first account/workspace deletion, idempotent member warning claims, service-only atomic finalization, and administrator backup guidance; 294 Vitest checks, 419 pgTAP assertions, lint/typecheck/build, runnable browser baseline, and independent review are green.

- 2026-08-13T08:00Z [PLANNED] GH-12 approved: add privacy-safe filter-faithful CSV export, durable retryable account/workspace deletion with confirmed Plaid revocation, guarded owner/member UX, optional SMTP notification, and operator backup/restore documentation.

- 2026-08-13T01:58Z [READY] GH-11 adds linker-owned Plaid connection dossiers, audited retroactive visibility changes, update-mode repair and fresh reconciliation, fail-closed keep-history/delete-data disconnect recovery, and member-departure revocation; 253 Vitest checks, 390 pgTAP assertions, lint/typecheck/build, and independent review are green. The authored real-backend browser cases remain fixture-gated (14 runnable baseline cases passed, 84 skipped, 0 failed).

- 2026-08-13T00:39Z [PLANNED] GH-11 approved: add linker-owned Plaid connection summaries, audited retroactive visibility controls, update-mode account reconciliation, recent-password disconnect lifecycles, member-departure revocation, and responsive database/unit/API/component/Playwright coverage.

- 2026-08-12T23:00Z [READY] GH-10 adds secure effective-dated Family/Personal monthly category targets, shared-accounting progress, accessible 75/90/100/over states, and deterministic real-backend browser coverage; 211 Vitest checks, 340 pgTAP assertions, lint/typecheck/build, and independent review are green.

- 2026-08-12T22:42Z [PLANNED] GH-10 approved: add secure effective-dated Family/Personal monthly category targets, accounting-aware progress, accessible threshold states, and database/unit/API/component/Playwright coverage.

- 2026-08-12T22:19Z [READY] GH-9 adds strict Family/Personal dashboard and ledger reads, Canadian period cash flow, budgets, cached Plaid balance freshness, complete searchable transactions, and no Combined privacy view; 175 Vitest checks, 316 pgTAP assertions, lint/typecheck/build, the runnable browser baseline, and independent review are green.

- 2026-08-13T04:00Z [PLANNED] GH-9 approved: build strict Family/Personal dashboard read models, period-aware cash-flow and budget views, cached account freshness, and complete searchable transaction exploration with privacy, unit/API/component/database, and Playwright coverage.

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

- Provision live owner/member/invitation fixtures for the environment-gated browser journeys. This is the largest standing coverage gap: the full browser suite runs 14 cases and skips 96.
- Submit the Plaid Trial/Production application. The review is the long-lead item for real bank data and nothing else depends on it, so it should start now rather than at GH-15.
- Verify the destructive GH-11 and GH-12 flows against the deployment while the data is disposable: per-Item disconnect in both modes, account-data deletion, and workspace deletion back to first-owner setup. None has ever run against a real backend.
- Under GH-14: export `PLAID_E2E_PROVIDER` in CI and stop fixture-absent browser journeys from skipping silently; add Sandbox credentials as repository secrets.
- Under GH-15: add `.gitattributes` (`* text=auto eol=lf`) so `pnpm format:check` passes on Windows checkouts.
