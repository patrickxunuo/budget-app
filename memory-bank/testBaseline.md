# E2E Test Baseline

## Overview

- Framework: Playwright (`playwright`, desktop and mobile Chromium)
- Command: `pnpm test:e2e`
- Test directory: `e2e/`
- GH-3 suite: `e2e/auth.spec.ts`
- Latest run: 14 passed, 64 fixture-dependent scenarios skipped, 0 failed (78 desktop/mobile cases; local Supabase environment)

## GH-9 Family and Personal Financial Dashboards

- [x] Strict Family versus signed-in-member Personal scope switch across summaries, charts, budgets, accounts, and transaction rows — component/API/database coverage passes; desktop/mobile Playwright authored
- [x] Calendar day, Monday-Sunday week, month, custom range, and previous/next navigation in the configured Canadian timezone — domain/component coverage passes; real-backend Playwright authored
- [x] Search plus account, category, pending/posted, and included/excluded/transfer filters with complete pre-limit totals — API/component coverage passes; real-backend Playwright authored
- [x] Cached nullable Plaid available/current balances, freshness, accessible cash-flow data, budget progress, mobile layout, keyboard focus, and reduced motion — provider/database/component coverage passes; screenshots authored
- Test file: `e2e/dashboard.spec.ts`; latest GH-9 browser result: 12 desktop/mobile scenarios fixture-gated because `E2E_DASHBOARD_MEMBER_*` credentials were not supplied, 0 failed. Full browser suite: 14 runnable passed, 64 fixture-dependent skipped, 0 failed.

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
- Latest database run: 316 pgTAP assertions passed across schema, RLS, auth lifecycle, Plaid activation, atomic transaction sync, accounting, scoped categories, merchant rules, Manual/Cash entries, and dashboard balance privacy.

## Artifacts

Playwright screenshots and reports are written beneath `test-results/` and `playwright-report/`.

## Bugs Discovered

(none)
