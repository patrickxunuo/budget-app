# E2E Test Baseline

## Overview

- Framework: Playwright (`playwright`, desktop and mobile Chromium)
- Command: `npm run test:e2e`
- Test directory: `e2e/`
- GH-3 suite: `e2e/auth.spec.ts`
- Latest run: 28 passed, 12 fixture-dependent scenarios skipped, 0 failed

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
- Latest database run: 217 pgTAP assertions passed across schema, RLS, auth lifecycle, and Plaid activation suites.

## Artifacts

Playwright screenshots and reports are written beneath `test-results/` and `playwright-report/`.

## Bugs Discovered

(none)
