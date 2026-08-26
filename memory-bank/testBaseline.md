# E2E Test Baseline

## Overview

- Framework: Playwright (`playwright`, desktop and mobile Chromium)
- Command: `pnpm test:e2e`
- Test directory: `e2e/`
- GH-3 suite: `e2e/auth.spec.ts`
- Pre-CI branch run: 102 passed, 90 fixture-dependent scenarios skipped, 0 failed (192 desktop/mobile cases) on `feat/GH-32-route-loading-skeletons`. The first GitHub run after merging GH-30 exposed a harness mismatch: route-loading cases that require production Link prefetching were repeated under `next dev`, retries exhausted the 25-minute job budget, and GitHub recorded the job as cancelled. CI now isolates those 24 cases against `next start` before running the remaining deterministic-Plaid suite against `next dev`.
- Previous run: 98 passed, 70 fixture-dependent scenarios skipped, 0 failed (168 desktop/mobile cases). GH-14 raised the runnable count from 36 to 98 by seeding an owner with `pnpm seed:e2e` and adding the fixtureless security-hardening spec; GH-13 had raised it from 14 to 36.
- Running the suite needs roughly 2 GB of headroom. On a loaded workstation `next dev` is killed by the OS with `FATAL ERROR: Zone Allocation failed`, and every case then fails with `ERR_CONNECTION_REFUSED` from a dead web server rather than from a real defect. Run `CI=1 pnpm exec playwright test --workers=1` in that situation: `CI=1` switches the `webServer` to the production `pnpm start`, which is far lighter than the dev server.

## GH-64 Dedicated Transaction Management Routes

- [x] Route/component acceptance proves `/transactions` reads only the overview model, dedicated Manual and Plaid routes independently authorize and load their scoped datasets, unsafe return targets fall back locally, Manage/Back links preserve canonical filters, both exports use desktop-only layout semantics, and all three loading fallbacks match their routes. The focused loading/route set passes 56/56 and the complete Vitest suite passes 955/955.
- [x] `e2e/transactions-management.spec.ts` covers read-only overview boundaries, scope/filter-preserving Manage and Back navigation, unsafe return targets, dedicated Plaid controls, browser history, mobile/desktop export visibility, and screenshot checkpoints without API mocks. Existing Manual and category journeys now target their dedicated routes.
- The configured one-pass `npm run test:e2e` run completed with 62 passed, 152 fixture-gated skips, and 12 unrelated missing-environment failures. All eight GH-64 desktop/mobile cases skipped because no dashboard fixture or Supabase/server environment was provisioned; no GH-64 browser assertion executed or failed, and no GH-64 screenshot was produced locally. After that run, navigation, safe-return, history, and responsive-export cases were narrowed to the lighter `auth-owner` gate; only the seeded Plaid-row case still requires `dashboard`.

## GH-65 Complete Transaction Cursor Pagination

- [x] `src/lib/dashboard/cursor-pagination.test.ts`, direct `readDashboard` service coverage over 61 mixed-source rows, dashboard domain/route coverage, and `transaction-explorer.test.tsx` prove opaque cursor validation, deterministic date/source/id continuation (including removed boundaries), complete counts/totals, 10/50 responsive reveal, buffered and fetched expansion, query resets, stale-response rejection, current-Toronto plain-URL defaults, retry retention, and cursor-free URL/CSV state. Focused verification is 77/77 and the full Vitest suite is 983/983.
- [x] `e2e/dashboard.spec.ts` contains real-backend mobile/desktop traversal, responsive count, filter/plain-URL reset, URL/CSV depth isolation, 44 px target, and screenshot journeys with no API mocking.
- The required one-pass `npm run test:e2e` run completed with 83 passed, 124 fixture-gated skips, and 25 environment/authentication failures across 232 cases. GH-65's three desktop project cases skipped because the standard financial seed contains fewer than 11/51 transactions; its mobile traversal/desktop-window cases failed at shared-fixture sign-in during the six-worker full run, before any GH-65 assertion, and its reset case skipped for insufficient rows. An earlier focused single-worker GH-65 run provisioned the dashboard family and skipped all six cases cleanly for the same dataset-size gate. No browser claim is represented as passing.

## GH-63 Spending-History Axes and Interactive Readings

- [x] Component acceptance covers adaptive day/CAD ticks, zero and negative ranges, pointer hover, touch pinning/outside dismissal, keyboard navigation/Escape, assistive readings, missing baselines, single points, and the retained semantic table; 16/16 focused and 915/915 full Vitest checks pass.
- [x] `e2e/dashboard.spec.ts` adds real-backend desktop and mobile journeys for axes, nearest-day readings, keyboard/touch behavior, responsive density, the semantic fallback, and screenshot checkpoints without request mocks.
- The configured one-pass browser run completed with 74 passed and 142 fixture-dependent skips. All four GH-63 project cases skipped because `E2E_DASHBOARD_MEMBER_EMAIL` / `E2E_DASHBOARD_MEMBER_PASSWORD` were absent; no GH-63 browser assertion executed or failed, and no GH-63 screenshot was produced locally.

## GH-62 Verified Plaid Login Repair

- [x] Database and component regressions prove a successful atomic provider sync clears `needs_login_repair` and the prior login error, preserves Item/account/scope/transaction identity, and coordinates Action needed to Connected only after update-token → reconcile → sync. The focused 5 component checks, full 912-check Vitest suite, and 494 pgTAP assertions pass (red → green captured).
- [x] `e2e/plaid-connections.spec.ts` includes the no-mock real-backend journey `Bug: Plaid repair clears Action needed after verified sync` with a repaired-state screenshot. The one configured `npm run test:e2e` run produced 64 passed, 140 skipped, and 10 unrelated missing-environment failures; both GH-62 desktop/mobile cases skipped because the `plaid-repair` fixture (`PLAID_E2E_PROVIDER`, Sandbox mode, member credentials, `E2E_PLAID_REPAIR_STATE=1`) was absent.

## GH-26 Themed Select and Searchable Dropdowns

- [x] The shared standard/searchable primitive and all 14 migrated contexts have Vitest coverage for pointer, keyboard/typeahead, focus return, disabled/required/ARIA state, search filtering/result announcements/empty state, `FormData`, repository-wide native-select removal, and preserved feature behavior. The focused 58-check set and complete 907-check Vitest suite pass.
- [x] Existing real-backend journeys in `budgets`, `categories`, `dashboard`, `data-lifecycle`, `manual-entries`, and `plaid-connections` now drive visible dropdown triggers through `e2e/support/select.ts`; category-search and 390 px reduced-motion screenshots are authored without request mocks.
- Browser verification was attempted exactly once with the configured `npm run test:e2e`: 64 passed, 138 fixture-dependent cases skipped, and 10 unrelated auth/foundation cases failed because every required Supabase/server environment value was absent. The authenticated GH-26 journeys therefore remain environment-limited; no GH-26 browser assertion executed or failed, and no visual pass is claimed.

## GH-33 Shared Pending Mutation Controls

- [x] Component acceptance covers the shared exclusive/latest hook, layout-stable accessible button, and transaction ledger, Plaid connections, budgets, categories, Manual/Cash, and transaction explorer migrations: 49 focused checks and the complete 909-check Vitest suite pass.
- [x] `e2e/support/pending.ts` observes the real DOM before activation, without request interception, so existing category/rule and Plaid visibility/disconnect journeys can prove transient `aria-busy` plus disabled state even when the real backend responds quickly.
- Browser verification was attempted once with `npm run test:e2e`: GH-33's fixture-backed categories and Plaid cases skipped because their credentials were absent, while 10 unrelated fixtureless/protected cases failed because the worktree lacked required Supabase/server environment values; no product bug was inferred. Review then added and ran the fixtureless `e2e/pending-button.spec.ts` focus case against the app's compiled CSS: 1/1 desktop Chromium passed, proving unchanged computed bounds through an observed pending transition, `pending-button-dot` with motion allowed, `animation-name: none` for all dots under reduced motion, and representative shared-button labels from every adopting mutation surface. The real-backend observer journeys remain authored and fixture-gated.

## GH-35 Manual-Entry and Dashboard Journey Repairs

- [x] `e2e/manual-entries.spec.ts` creates uniquely scoped Family and Personal categories, proves form privacy is independent from URL ledger scope, and opens the matching ledger before row assertions, edits, deletes, and CSV checks.
- [x] `pnpm seed:e2e:financial` is a separate loopback-only, idempotent seed for the GH-31 Family dashboard: a pending non-syncable Item container, a current-month `CA$250.00` categorized spend against a `CA$1,000.00` target, one account with real balances/freshness, and one null-balance account. The identity seed now provisions `manual-entries`; CI deliberately runs the financial seed twice and requires both families.
- [x] `e2e/dashboard.spec.ts` asserts exact seeded budget figures, balances/freshness, and `Unavailable` for null balances without restoring the explorer removed by GH-31. CLI safety, the no-committed-password contract, 897 Vitest checks, lint, typecheck, changed-file formatting, and the production build are green.
- Docker-backed local verification is complete: 487 pgTAP assertions pass; the financial seed reconciles the same rows on consecutive runs; its disposable `GITHUB_ENV` contract exports both dashboard credentials; and all 20 focused desktop/mobile cases pass against real local APIs in 53.8 seconds. Individual cases take 1.5-4.7 seconds. The initial dev-mode failure was a cold Next compilation that left sign-in pending past a 5-second assertion, not a product regression; the same case passed in 3.2 seconds against the production server.
- [PR #54 CI](https://github.com/patrickxunuo/budget-app/actions/runs/31928095966) completes the repository-wide boundary: 26/26 production route-loading cases passed, followed by 118 passing development-mode cases and 52 explicitly inventoried optional-fixture skips. All six required families were provisioned, including `manual-entries` and `dashboard`; deterministic Plaid Link remains isolated to the development-mode phase by design.

## GH-44 React Plaid Link 5 Nullable Success Token

- [x] `src/components/plaid/plaid-link-flow.test.tsx` drives the captured real `usePlaidLink` callback and guards the null-token recovery boundary: no exchange request, cleared pending token/review state, sanitized error, and usable retry. It was confirmed red on the unguarded callback (one exchange request) and green after the fix (3/3 checks), including the unchanged institution metadata and fallback paths.
- No new Playwright scenario was authored: the nullable SDK callback is not surfaceable through the real deterministic browser adapter without adding a synthetic product path. Existing `e2e/plaid-link.spec.ts` remains the surrounding flow coverage.
- The configured `npm run test:e2e` was attempted once with `E2E_SERVER_MODE=dev` and `E2E_REQUIRED_FIXTURES=plaid`, but Playwright did not start because the local Volta npm launcher is missing `npm-prefix.js`; `PLAID_E2E_PROVIDER`, Sandbox mode, and Plaid member credentials are also unset. Browser acceptance remains environmentally unverified, not passed. The runner-provided `tests/e2e/` directory also disagrees with Playwright's actual `./e2e` `testDir`; no files were authored into the stale path.

## GH-31 Read-Only Month-to-Date Dashboard

- [x] Request-current Toronto month, aggregate budget health/pace, no-budget fallback, normalized prior-month cumulative baseline, nullable account balances, and strict Family/Personal scope — 22 new domain/service/route/component checks pass; full Vitest is 880/880.
- [x] `e2e/dashboard.spec.ts` now covers the read-only dashboard, real scope refresh, 390/768/1280 overflow, 44px scope targets, reduced motion, initial-viewport budget figures, and the four-block GH-31 loading skeleton without API mocks.
- Browser verification did not start in this flight: the configured `npm run test:e2e` command failed inside the local Volta npm launcher because `npm-prefix.js` is missing. No Playwright/product assertion ran or failed; the authored GH-31 journeys remain fixture-gated and unverified.

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
- Harness pitfall found the hard way — **a route-loading assertion is valid only after the partial fallback prefetch is known to have succeeded.** Next enables automatic Link prefetching in production, not development. The old helper ran under `next dev`, tried a hover, swallowed an eight-second prefetch miss, and then delayed the navigation response; with no cached fallback, the previous page correctly remained visible and the skeleton assertion could never pass. CI now runs this spec against `next start`, starts response listeners before the dashboard mounts, requires a successful RSC prefetch, and only then installs the navigation throttle. `blockPrefetchAndThrottle` (prefetch refused) remains for FE-005, where a genuinely uncached destination is the behavior under test.
- Latest automated verification: 801 Vitest checks across 58 files (up from 486/47), `format:check`, lint, `next typegen` + typecheck, and the production build all green. Browser: 102 passed, 90 fixture-skipped, 0 failed across all 13 specs.
- Screenshots of both throttled destinations are attached on both projects, and are the evidence for "the shell is never blanked" that a DOM assertion alone reads as abstract.
- Local runs used a temporary port-3210 copy of `playwright.config.ts`, deleted before commit: port 3100 was held by an unrelated worktree's dev server, and `reuseExistingServer` would have run this suite against another branch's code — a green that means nothing.
- Harness note — CI intentionally uses two Playwright invocations. `e2e/route-loading.spec.ts` drives the already-built production server because its contract includes automatic partial prefetching; the remaining specs drive `next dev` because deterministic Plaid Link is compile-time-disabled in production. `E2E_EXCLUDE_ROUTE_LOADING=1` prevents the production-only contract from being repeated under the wrong server mode.
- Known gap — AC3's "within 100ms" is proven structurally (a prefetched route-level fallback commits immediately), not with a timing assertion, and AC13's "no flash" is asserted as the CSS delay rule rather than observed frame-by-frame in a browser.

## GH-30 Transactions Exploration and Export

- [x] Free-text search over merchant/description and account name, plus account, category, status, and inclusion filters on `/transactions` — component coverage passes (COMP-002); browser coverage re-pointed
- [x] Day/Monday-Sunday week/month/custom period selection with previous/next navigation in the configured Canadian timezone — filter-contract and component coverage passes; browser coverage re-pointed
- [x] Mutually exclusive Family/Personal scope with no reachable combined view — component coverage passes (COMP-009); `scope=combined` is not representable by `parseExplorerFilters` (UNIT-002)
- [x] Composed filters narrow the set while summary totals reflect the complete filtered set rather than the rendered page — component coverage passes (COMP-002/003), with a fixture whose `summary` deliberately contradicts any arithmetic over the rendered rows
- [x] CSV export of the exact scoped and filtered view, unavailable with a stated reason while a refresh is in flight or the set is empty, and restored to the last successful snapshot after a rejected refresh — component coverage passes (COMP-004/005/006/013)
- [x] Explicit empty state naming the filters that produced it — component coverage passes (COMP-007)
- [x] Filtered view survives reload and is shareable as a link — filter-contract round trip passes (UNIT-007) and the URL sync is asserted (COMP-008); browser evidence is FE-007, authored but not executed
- Test files: `src/lib/transactions/explorer-filters.test.ts` (UNIT-001..008) and `src/components/transactions/transaction-explorer.test.tsx` (COMP-001..017) — 55 new Vitest checks, all passing. UNIT-005/006 feed `toReadModelQuery` output straight into the real `dashboardQuerySchema` / `dashboardExportQuerySchema`, so a key the strict server schemas would reject fails the unit suite rather than the browser.
- Two independent review passes found six defects that the authored tests did not. All are fixed, and every fix has a regression case (COMP-013..017) that was verified to **fail** against the pre-fix code rather than merely to pass against the fixed code — a test written after a fix proves nothing until you watch it go red.
  - **A late response rewrote the address bar after unmount.** The effect cleanup only cleared the debounce timer; once the timer had fired the fetch continuation was uncancellable, and the request-id guard could not catch it because the ref it compares against belongs to the unmounted instance. Selecting a scope (which remounts the explorer) while a refresh was in flight therefore `replaceState`d the URL back to the scope just left — the address bar naming one ledger while another was on screen. Fixed with a `cancelled` flag set by the cleanup and checked before every post-`await` side effect. COMP-014 is the regression, and it was verified to fail against the unguarded version rather than merely to pass against the fixed one.
  - **`await findByTestId` does not wait on an always-mounted region.** COMP-010 copied the dashboard's pattern, but the live-region rule requires the alert to be mounted empty, so `findBy*` resolved on its first pass and the content assertions raced the refresh. Any assertion on a mounted-empty region must `waitFor` the _content_, never `findBy*` the element. The same trap applies to `transactions-loading`.
  - **`key={filters.scope}` on the page was too narrow.** It forced a remount on a scope push, but not on a navigation that changed only the filters, so the explorer could keep a view the address bar no longer described. Keyed on the whole applied query instead; `replaceState` does not re-render the server component, so filter changes still do not remount.
  - **The empty state described the live controls, not the rendered rows** (COMP-015). After a rejected refresh those disagree, so it blamed a filter that had never been applied to anything.
  - **An account/category id with no matching option left the select reading "All"** while the request stayed narrowed (COMP-016) — the UI misreporting its own state. It now renders an explicit "Unavailable" option, and `describeActiveFilters` names it as unavailable rather than echoing a raw UUID.
  - **`customRangeTouched` never cleared** (COMP-017), so leaving and re-entering the custom period silently applied dates that had been typed but never applied. Reset when the period leaves `custom`; the flag still does its real job while the member stays on it.
- Known limit, deliberately not fixed here: a React `key` cannot catch a return to a URL the server already rendered once. Land on a bare `/transactions`, apply filters (client-side only), then click the nav's own `/transactions` link — the server sees identical input both times and emits the same key, so the filtered view survives under a bare URL until the next reload. It is never a scope or privacy mismatch (any scope difference does change the key) and it self-corrects on reload, so it is not one of GH-30's acceptance criteria. Closing it needs the explorer to reconcile against `useSearchParams()`, which is follow-up work.
- Browser coverage was **re-pointed, not duplicated**: `e2e/dashboard.spec.ts` FE-002 (period navigation), FE-003 (composed filters), and FE-006 (390 px) now run against `/transactions` with `transactions-*` ids; `e2e/data-lifecycle.spec.ts` FE-001 (×2, the GH-12 export journeys) likewise; new FE-007 covers reload and shared-link reproduction. FE-001/004/005 stay on `/dashboard`, which keeps its own controls until #31. `playwright test --list` registers all 170 cases across 12 files.
- **FE-006 now asserts the 44 px minimum touch target and that the controls sit above the ledger** — checks the dashboard-era spec never made. Neither has executed.
- Latest GH-30 browser result: **not run.** The suite could not be executed against this branch — port 3100 was already held by a foreign `next` server from another checkout, and `reuseExistingServer` would have tested that checkout's code rather than this branch's, which is worse than not running. Separately, the `dashboard` and `data-lifecycle` fixture families remain unprovisioned, so all six re-pointed/new cases would have skipped even with a correct server. Every `/transactions` browser assertion above is therefore authored-only.
- Latest automated verification: 754 Vitest checks across 57 files, green on consecutive full-suite runs rather than one — the first review's finding passed in isolation and failed only under full-suite load order, so a single green run is not evidence here. Lint, Next route generation/typecheck, the production build, and Prettier on every changed file are also green.

## GH-15 Deployment and Operations Documentation

- No new runtime flow or application UI changed, so no Playwright spec was added and the full E2E suite was not rerun for this documentation-only flight.
- Real, data-free captures of `/` and `/install` were visually verified and committed under `docs/screenshots/`; the documentation contract is covered by 10 Vitest checks.

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
- Closed in GH-35. The old `manual-entries.spec.ts` FE-001 incorrectly expected Personal and Family rows on one URL-scoped ledger; the repaired journey asserts each row only on its matching ledger and creates unique scoped categories.
- Closed in GH-35 for `dashboard` while `plaid-connection` remains open. A distinct financial seed now supplies accounts, balances/freshness, current-month categorized spend, and budget progress for the GH-31 overview and GH-30 transaction journeys; CI requires the family instead of allowing a silent skip.
- Live Plaid contract coverage is the `pnpm smoke:plaid` script (`scripts/plaid-sandbox-smoke.mjs`), which is manual and Sandbox-only. It covers link token creation, Canadian Transactions entitlement, Item exchange, institution lookup, CAD accounts, transaction sync, update mode with and without account selection, `ITEM_LOGIN_REQUIRED` recovery, and item removal. Webhook signature verification is not covered because it needs a publicly reachable URL.
