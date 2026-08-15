# E2E Test Baseline

## Overview

- Framework: Playwright (`playwright`, desktop and mobile Chromium)
- Command: `pnpm test:e2e`
- Test directory: `e2e/`
- GH-3 suite: `e2e/auth.spec.ts`
- Latest run: 102 passed, 90 fixture-dependent scenarios skipped, 0 failed (192 desktop/mobile cases) on `feat/GH-32-route-loading-skeletons`. GH-32 added 24 cases. The passed/skipped split differs from the 98/70 below because that run was CI, which provisions `plaid`, `categories`, and `budgets-service-cleanup`; the GH-32 run provisioned only `auth-owner` (plus `categories` by fallback), so more families skipped. That is a provisioning difference, not a regression — 0 failed either way.
- Previous run: 98 passed, 70 fixture-dependent scenarios skipped, 0 failed (168 desktop/mobile cases). GH-14 raised the runnable count from 36 to 98 by seeding an owner with `pnpm seed:e2e` and adding the fixtureless security-hardening spec; GH-13 had raised it from 14 to 36.
- Running the suite needs roughly 2 GB of headroom. On a loaded workstation `next dev` is killed by the OS with `FATAL ERROR: Zone Allocation failed`, and every case then fails with `ERR_CONNECTION_REFUSED` from a dead web server rather than from a real defect. Run `CI=1 pnpm exec playwright test --workers=1` in that situation: `CI=1` switches the `webServer` to the production `pnpm start`, which is far lighter than the dev server.

## GH-32 Route-Level Loading Skeletons and Navigation Pending Feedback

- [x] Segment-level loading file for each of the six authenticated destinations, each reproducing its route's own `<main id="main-content" tabIndex={-1}>` wrapper, padding, and container width — component coverage passes; desktop/mobile Playwright runnable
- [x] Shell survives a tab switch: rail, bottom bar, and workspace header stay visible, stay interactive, and are the _same DOM nodes_ before and after — asserted two ways (a `data-shell-probe` attribute React would not re-add to a rebuilt node, plus an `ElementHandle` identity check) — desktop/mobile Playwright runnable
- [x] Navigation is interruptible: a second destination activated while the first is pending resolves to the second, and still holds after the abandoned response lands — desktop/mobile Playwright runnable
- [x] Skeletons are data-free — no digit, currency symbol, or fabricated account/merchant/category name; the polite announcement is the only text in the subtree — component coverage passes
- [x] Polite busy state: `aria-busy` on the main plus one `role="status"` region that **mounts empty and fills after commit**, verified against `renderToStaticMarkup` rather than RTL's effect-flushed render, because only the mount output decides whether AT announces — component coverage passes
- [x] Reduced motion yields a genuinely flat placeholder: the sweep pseudo-element is removed (`content: none`), not clamped. The pre-existing global reduced-motion rule only forces `animation-duration: 0.01ms`, which parks a translating sweep on its end frame — a lopsided static gradient. Asserted in the browser (FE-006) on the _computed_ `::after` content under `emulateMedia({ reducedMotion: "reduce" })`, with a paired assertion that the same shape does carry a sweep when motion is allowed, so the check cannot pass on a rule that never applied — component + Playwright coverage passes
- [x] Pending affordance in both navigation surfaces, always mounted at a fixed size (both states' markup differ _only_ by `data-pending`), shaped as a three-dot cluster against the solid `aria-current` bar, fading in on a 100ms delay so a prefetched transition never flashes — component coverage passes, plus FE-005 driving the **real `useLinkStatus`** in a browser through `false → true → false`
- [x] Root loader restyled into the same language, carrying `root-loading` rather than `route-skeleton`, and asserted absent across three throttled authenticated tab switches — component/Playwright coverage passes
- [x] No horizontal overflow at 390px, 768px, or 1280px _while a skeleton is displayed_, for both `/transactions` and `/accounts` (the latter carries the widest fixed furniture in the set) — desktop/mobile Playwright runnable
- Test file: `e2e/route-loading.spec.ts` (FE-001..FE-006; 12 scenarios × desktop/mobile = 24 cases). Gated on `auth-owner`, which CI provisions, so it runs there. Local verification ran it with `E2E_REQUIRED_FIXTURES=auth-owner` so it could not silently skip: **24/24 passed** against `next start`, and FE-004 was additionally run with `--repeat-each=2` (24/24) after the flake below.
- Harness pitfall found the hard way — **a prefetch of a dynamic route usually returns only the fallback, but it can return the whole payload.** When it does, the click commits straight from the router cache, issues no request, and a `page.route` throttle never fires, so no skeleton is ever displayed. That is correct product behaviour and a broken test; it surfaced once as an FE-004 failure whose page snapshot showed fully-rendered content. Refusing the prefetch is _not_ the fix — measured, that leaves the old page on screen for the whole throttle and fails outright, because the fallback is only instant when Next already holds it. The fix is a longer throttle plus a longer visibility timeout, keeping the prefetch pass-through. `blockPrefetchAndThrottle` (prefetch refused) is kept for FE-005, where a genuinely un-cached destination is the whole point.
- Latest automated verification: 801 Vitest checks across 58 files (up from 486/47), `format:check`, lint, `next typegen` + typecheck, and the production build all green. Browser: 102 passed, 90 fixture-skipped, 0 failed across all 13 specs.
- Screenshots of both throttled destinations are attached on both projects, and are the evidence for "the shell is never blanked" that a DOM assertion alone reads as abstract.
- Local runs used a temporary port-3210 copy of `playwright.config.ts`, deleted before commit: port 3100 was held by an unrelated worktree's dev server, and `reuseExistingServer` would have run this suite against another branch's code — a green that means nothing.
- Harness note — **`next dev` compiles viewport prefetching out** (`onLinkVisibilityChanged` returns early unless `NODE_ENV === "production"`); hover/touch intent prefetch is not gated. CI runs `E2E_SERVER_MODE=dev`, so the spec warms each destination once and then hover-prefetches before installing its throttle. The `page.route` handler passes `Next-Router-Prefetch` requests through untouched and delays only the navigation — throttling the prefetch would remove the very fallback under test.
- Known gap — AC3's "within 100ms" is proven structurally (a prefetched route-level fallback commits immediately), not with a timing assertion, and AC13's "no flash" is asserted as the CSS delay rule rather than observed frame-by-frame in a browser.

## GH-13 Installable, Accessible, Mobile-First PWA

- [x] Installable manifest with reachable 192/512 `any` and 192/512 `maskable` PNG icons, plus a 180px Apple touch icon — manifest/route coverage passes; desktop/mobile Playwright runnable
- [x] `/sw.js` served uncacheable (`no-cache, no-store, must-revalidate`) and scoped to the whole origin with `Service-Worker-Allowed: /` — desktop/mobile Playwright runnable
- [x] Cross-platform install guidance at `/install` for Android/Chromium, iOS/iPadOS Safari, and desktop, reachable from the landing page and the app shell — component/Playwright coverage passes
- [x] Data-free offline screen asserted to contain no figure or currency symbol — component/Playwright coverage passes
- [x] "Skip to content" as the first tab stop, moving focus into `#main-content` — desktop/mobile Playwright runnable
- [x] Overflow-free public shell at 390px, 768px, and 1280px — desktop/mobile Playwright runnable
- [x] Service-worker cache policy: `public/sw.js` is executed in Vitest against synthetic fetch events, proving `/api/**`, every application document, cross-origin Supabase/Plaid, non-GET, and range requests are never read from or written to a cache — 38 unit assertions pass
- [x] WCAG AA palette gate: `src/lib/theme/contrast.test.ts` parses `src/app/globals.css` and asserts every text pair at 4.5:1 and every UI pair at 3:1 in both themes, and that the `prefers-color-scheme` palette cannot drift from the explicit one — 71 unit assertions pass
- [x] Compact Light/Dark theme toggle (device preference by default), pre-hydration application, live device-theme tracking, and storage-failure fallback — unit/component coverage passes
- [x] Mobile bottom navigation versus desktop rail, `aria-current="page"`, and a non-colour active indicator — component coverage passes
- [x] Service-worker update prompt: no self-`skipWaiting`, prompt only when a controller already exists, single guarded reload — component coverage passes
- Test file: `e2e/pwa.spec.ts` (11 scenarios × desktop/mobile = 22 cases, all runnable with no fixtures). Screenshots of `/install` are attached on both projects.
- Known gap — the worker is never exercised by a real browser. `public/sw.js` is proven only against the synthetic harness in `src/lib/pwa/service-worker.test.ts`, so registration, the offline fallback on a failed navigation, and the update prompt have no end-to-end evidence. This is a genuine gap, not a limitation: the registrar is production-only, but `CI=1` already runs the suite against `pnpm start`, so a `context.setOffline(true)` navigation case is possible and worth adding.
- Also covered in jsdom rather than the browser: theme switching and the bottom-nav/rail swap, both of which live inside the authenticated shell.
- The application shell mounts two always-present `role="status"` live regions (connectivity and service-worker updates). Any Playwright assertion on a page's own status message must be scoped — `page.getByRole("main").getByRole("status")`, or scoped to the form — or it is ambiguous under strict mode.
- Latest automated verification: 486 Vitest checks across 47 files (189 new), lint, Next route generation/typecheck, and the production build are green.
- Resolved in GH-14. Provisioning the `auth-owner` fixture made the predicted ambiguity fire: `auth.spec.ts` FE-004 matched three elements inside `<main>` — two open `Feedback` regions plus the `<output>` holding the invite URL, which carries an implicit `status` role of its own. Each of the membership console's eight feedback regions now takes a required `testId`, and the three assertions in `auth.spec.ts` and `data-lifecycle.spec.ts` target the region for the action they just performed rather than `getByRole("status")`.

## GH-12 Data Portability and Lifecycle Controls

- [x] Filter-faithful Family/Personal CSV download with complete paged reads, safe columns, RFC 4180 quoting, UTF-8 BOM, and spreadsheet formula-injection protection — route/domain/component coverage passes; real-backend desktop/mobile Playwright authored
- [x] Recent-password plus explicit account/workspace confirmation, exact owner name/impact acknowledgement, and accessible retry feedback — action/component/database coverage passes; real-backend Playwright authored
- [x] Provider-first retryable Plaid revocation, atomic full-graph workspace teardown, durable all-member Auth deletion outbox, and first-owner setup return — service/pgTAP coverage passes; destructive Playwright authored
- [x] Optional SMTP member warning plus clear Supabase-administrator backup/restore boundary — environment/service/component coverage passes
- Test file: `e2e/data-lifecycle.spec.ts`; latest GH-12 browser result: 12 desktop/mobile scenarios fixture-gated because `E2E_DATA_LIFECYCLE_*` credentials and a disposable destructive workspace were not supplied, 0 failed. Full browser suite: 14 runnable passed, 96 fixture-dependent skipped, 0 failed.
- Latest automated verification: 294 Vitest checks and 419 pgTAP assertions passed; lint, Next route generation/typecheck, production build, and independent review are green.

## GH-11 Plaid Connection Management

- [x] Linker-only institution/account dossier with masked identity, ownership, visibility, cached balances, sync freshness, health, and Item-wide impact — component/API/database coverage passes; desktop/mobile Playwright authored
- [x] Explicit retroactive Personal/Family visibility changes with dashboard/budget recalculation copy and Family audit history — component/API/database coverage passes; real-backend Playwright authored
- [x] Update-mode repair/account-selection and fresh returned/new/deselected reconciliation without stale-ID reuse — provider/API/database coverage passes; real-backend Playwright authored
- [x] Recent-confirmation keep-history/delete-data disconnect plus member-departure revocation preserving read-only Family history — API/database coverage passes; destructive Playwright authored
- [x] Mobile, keyboard, reduced-motion, non-color health states, and screenshot checkpoints — component coverage passes; desktop/mobile Playwright authored
- Test file: `e2e/plaid-connections.spec.ts`; latest GH-11 browser result: 10 desktop/mobile scenarios fixture-gated because `E2E_PLAID_CONNECTION_MEMBER_EMAIL` / `E2E_PLAID_CONNECTION_MEMBER_PASSWORD` and a disposable destructive fixture were not supplied, 0 failed. Full browser suite: 14 runnable passed, 84 fixture-dependent skipped, 0 failed.
- Latest automated verification: 253 Vitest checks and 390 pgTAP assertions passed; lint, Next route type generation, TypeScript, production build, and independent review are green. Disconnect recovery coverage proves the durable `claimed -> removal_started -> provider_removed -> finalized` lifecycle, fail-closed ambiguous failures, and retry without a duplicate provider call after confirmed removal.

## GH-9 Family and Personal Financial Dashboards

- [x] Strict Family versus signed-in-member Personal scope switch across summaries, charts, budgets, accounts, and transaction rows — component/API/database coverage passes; desktop/mobile Playwright authored
- [x] Calendar day, Monday-Sunday week, month, custom range, and previous/next navigation in the configured Canadian timezone — domain/component coverage passes; real-backend Playwright authored
- [x] Search plus account, category, pending/posted, and included/excluded/transfer filters with complete pre-limit totals — API/component coverage passes; real-backend Playwright authored
- [x] Cached nullable Plaid available/current balances, freshness, accessible cash-flow data, budget progress, mobile layout, keyboard focus, and reduced motion — provider/database/component coverage passes; screenshots authored
- Test file: `e2e/dashboard.spec.ts`; latest GH-9 browser result: 12 desktop/mobile scenarios fixture-gated because `E2E_DASHBOARD_MEMBER_*` credentials were not supplied, 0 failed. Full browser suite: 14 runnable passed, 64 fixture-dependent skipped, 0 failed.

## GH-10 Monthly Category Budgets

- [x] Explicit Family/Personal monthly target creation with CAD cents, matching scoped categories, and active-member/owner privacy — database/API/component coverage passes; desktop/mobile Playwright authored
- [x] Effective-dated revision and archival preserve historical targets while future months use the new target or no recurrence — database/API/component coverage passes; real-backend Playwright authored
- [x] Pending spending, exclusions, transfers, superseded pending rows, and refunds use shared accounting semantics with no rollover at local month boundaries — domain/API/database coverage passes
- [x] Spent, remaining, percentage, overage, and distinct 75/90/100/over text-plus-shape states remain responsive, keyboard-visible, and reduced-motion safe — component coverage passes; screenshots authored
- Test file: `e2e/budgets.spec.ts`; latest GH-10 browser result: 10 desktop/mobile scenarios fixture-gated because `E2E_BUDGET_MEMBER_*` credentials were not supplied. The one configured full-suite run also surfaced 10 pre-existing fixtureless auth/foundation failures because `.env.local` / required Supabase and server variables were absent; no GH-10 browser assertion ran or failed.

## GH-8 Manual/Cash Ledger

- [x] Personal income and Family spending/refund creation with explicit scope, kind, source, category, notes, and signed CAD validation — component/API/database coverage passes; desktop/mobile Playwright authored
- [x] Personal-owner privacy and Family collaboration with durable author/last-editor/deletion audit — component/API/database coverage passes; real-backend Playwright authored
- [x] Edit/error preservation, Personal direct soft deletion, and confirmed/cancellable Family deletion — component/API/database coverage passes; real-backend Playwright authored
- [x] Filtered RFC 4180 CSV, keyboard operation, reduced motion, responsive stacking, and screenshots — component/API coverage passes; real-backend Playwright authored
- Test file: `e2e/manual-entries.spec.ts`; latest GH-8 browser result: 8 desktop/mobile scenarios fixture-gated because `E2E_MANUAL_ENTRY_MEMBER_*` (or fallback active-member credentials) were not supplied, 0 failed. Full browser suite: 14 runnable passed, 52 fixture-dependent skipped, 0 failed.

## GH-7 Scoped Categories and Merchant Rules

- [x] Family/Personal category creation, privacy labels, archive controls, and rule register — component/API coverage passes; desktop/mobile Playwright authored
- [x] Original Plaid versus effective category display and one-off recategorization — component/API/database coverage passes; real-backend Playwright authored
- [x] Merchant identity preview, confirmation count, existing/future application, manual precedence, and shared audit history — domain/API/database coverage passes; real-backend Playwright authored
- [x] Mobile stacking, keyboard focus, reduced motion, and screenshots — Playwright authored
- Test file: `e2e/categories.spec.ts`; latest GH-7 browser result: 10 desktop/mobile scenarios fixture-gated because active-member/category transaction credentials were not supplied, 0 failed. Full browser suite: 14 runnable passed, 44 fixture-dependent skipped, 0 failed.

## GH-5 Idempotent Plaid Transaction Synchronization

- [x] Database-backed freshness renders without a Plaid call on page load — component coverage passes; desktop/mobile Playwright authored
- [x] Member “Check for updates” busy/success/error behavior — component coverage passes; real-backend Playwright authored
- [x] Login-repair and consent-expiration guidance stays sanitized and actionable — component coverage passes; fixture-gated Playwright authored
- [x] Mobile, keyboard, reduced-motion, and screenshot coverage — component coverage passes; fixture-gated Playwright authored
- Test file: `e2e/plaid-sync.spec.ts`; latest GH-5 browser result: 8 fixture-dependent desktop/mobile cases skipped because deterministic active-Item credentials were not supplied, 0 failed.

## GH-4 Read-only Canadian Plaid Linking

- [x] Link-token request and deterministic Link launch — desktop/mobile
- [x] Cancellation leaves no exchange side effect — desktop/mobile
- [x] Eligible/ineligible account review with actionable messaging — desktop/mobile
- [x] Independent Personal/Family scope selection — desktop/mobile
- [ ] Likely Family duplicate warning/override — authored; requires a pre-existing matching Family-account fixture (API reject/override coverage passes)
- [x] Activation and initial import status — desktop/mobile
- [x] OAuth expiry/retry state — desktop/mobile
- [x] Mobile, keyboard, reduced-motion, and screenshot coverage — desktop/mobile
- Test file: `e2e/plaid-link.spec.ts`; latest GH-4 result: 14 passed, 2 fixture-dependent variants skipped, 0 failed.

## GH-3 Authentication and Membership

- [ ] First-owner setup — authored; requires isolated empty Supabase plus `E2E_AUTH_ALLOW_SETUP=1`
- [x] Sign-in/recovery/reset surfaces — fixtureless recovery non-enumeration and accessibility pass on desktop/mobile
- [ ] Invitation validity/expiry/revocation/replay — authored; requires live invitation tokens
- [ ] Owner invitation/member management — authored; requires live owner credentials
- [ ] Member leave and owner-control isolation — authored; requires live member credentials
- [x] Anonymous protected-route redirect — passes on desktop/mobile
- [x] Responsive auth surfaces/screenshots — passes on desktop/mobile
- [ ] Absolute 30-day session expiry — authored; requires serialized expired-session cookies

## Database Regression Coverage

- `supabase/tests/database/auth-lifecycle.test.sql` covers setup closure/serialization, service-role boundaries, hashed/revocable/single-use invitations, direct-DML denial, ownership transfer, departure cleanup, sole-owner workspace deletion, and recent-password authorization.
- Latest database run: 390 pgTAP assertions passed across schema, RLS, auth lifecycle, Plaid activation and connection management, atomic transaction sync, accounting, scoped categories, merchant rules, Manual/Cash entries, dashboard balance privacy, and effective-dated monthly budgets.

## Artifacts

Playwright screenshots and reports are written beneath `test-results/` and `playwright-report/`.

## Bugs Discovered

All four defects below were found by hand against real Plaid Sandbox, not by the suite. Each lived in a path exercised only by mocks or the deterministic adapter, and each was invisible because the deterministic provider returns three simple CAD accounts with no balances while a real institution returns twelve accounts across investment, loan, and deposit subtypes.

- 2026-08-13 — `commit_plaid_sync` raised `unknown item account` for transactions on accounts the member never linked. Plaid returns activity for every account on an Item, so any institution holding an unsupported or unselected account could never complete a sync, and every retry reproduced it. Fixed in `21d6a03`.
- 2026-08-13 — `balanceCents` threw on any balance not exactly representable in cents, aborting the whole exchange. Tartan-Dominion's RRSP reports 23631.9805. Its absolute tolerance also rejected ordinary two-decimal balances such as 4523.19 and 76543.21. Fixed in `91bca92`.
- 2026-08-13 — The webhook payload schema declared `error` as an optional object, rejecting the explicit `"error": null` Plaid sends on TRANSACTIONS updates, so every real transaction webhook returned 400 after signature verification had already passed. Fixed in `d6f948b`.
- 2026-08-12 — `createLinkTokenForMember` always sent `redirect_uri` derived from `APP_URL`. Plaid rejects unregistered redirect URIs and only HTTPS origins can be registered, so every `/link/token/create` call from a local HTTP origin failed with `INVALID_FIELD`. The deterministic E2E provider ignores the field, so the whole suite stayed green against a completely broken link path. Fixed in `53138e4`; `oauthRedirectUri()` now omits the field unless the origin is HTTPS.

## Known Coverage Gaps

- Closed in GH-14. CI now exports `PLAID_E2E_PROVIDER`, seeds an owner, and runs the browser suite against `next dev` (`E2E_SERVER_MODE=dev`), so the deterministic Plaid journeys execute rather than skipping. They cannot run against a production build: the client guard in `plaid-link-flow.tsx` is a compile-time `NODE_ENV !== "production"` check.
- Closed in GH-14. A family named in `E2E_REQUIRED_FIXTURES` that is not provisioned now fails the run naming its missing variables, and `globalTeardown` prints the full inventory either way. CI requires `plaid`, `auth-owner`, `categories`, and `budgets-service-cleanup`.
- Still open, and now visible rather than silent: `dashboard`, `manual-entries`, and `plaid-connection` need financial data or a linked Item that the identity-only seed does not create, so 70 of 168 cases still skip. Two of them are also blocked on spec defects rather than fixtures — see below.
- Journey defects surfaced by GH-14, not caused by it. Both specs were authored under GH-8/GH-9 and had never executed, because their families always skipped:
  - `manual-entries.spec.ts` FE-001 creates one Personal and two Family entries, then asserts all three rows on a single page. The ledger is URL-scoped (`/transactions?scope=…`) with deliberately no combined view, so the assertion cannot hold against the product as built. It needs restructuring per scope.
  - `dashboard.spec.ts` FE-002/003/004 assert on balances, freshness, trend rows, and budget progress, none of which exist for a member with no accounts or transactions. They need a data fixture, not just an identity.
- Live Plaid contract coverage is the `pnpm smoke:plaid` script (`scripts/plaid-sandbox-smoke.mjs`), which is manual and Sandbox-only. It covers link token creation, Canadian Transactions entitlement, Item exchange, institution lookup, CAD accounts, transaction sync, update mode with and without account selection, `ITEM_LOGIN_REQUIRED` recovery, and item removal. Webhook signature verification is not covered because it needs a publicly reachable URL.
