# GH-14 — Automated Testing and Security Hardening

Establish that v1 preserves financial correctness, family privacy, secret boundaries,
and core user journeys — and that a green CI run means it, rather than meaning the
checks were skipped.

## Context

This is a gap-closing ticket. The repository already carries 486 Vitest checks across
47 files, 419 pgTAP assertions across 10 SQL suites, and 11 Playwright specs. Two
things are broken:

1. **CI overstates coverage.** `.github/workflows/ci.yml` never exports
   `PLAID_E2E_PROVIDER`, so the guards in `e2e/plaid-link.spec.ts` and
   `e2e/plaid-sync.spec.ts` skip on every run. Across the whole suite 96 of 132 cases
   skip silently, and a skip is indistinguishable from a pass in the summary line.
2. **The named security controls do not exist.** No CSP or transport headers, no
   origin/CSRF protection on state-changing requests, no rate limiting on the
   unauthenticated surfaces, no enforced redaction of log and error payloads, and no
   supply-chain scanning.

## Interface Contract

### `src/lib/security/redact.ts`

```ts
export const REDACTED = "[redacted]";

/** Recursively redacts secret-bearing keys and secret-shaped values. */
export function redact(value: unknown): unknown;

/** True when a key name denotes a secret, credential, or sensitive identifier. */
export function isSensitiveKey(key: string): boolean;

/** True when a string looks like a token/JWT/key regardless of its key name. */
export function isSensitiveValue(value: string): boolean;
```

### `src/lib/security/log.ts`

```ts
export type ServerLogLevel = "info" | "warn" | "error";

/** The only sanctioned server logging entry point. Redacts before writing. */
export function logServerEvent(
  level: ServerLogLevel,
  message: string,
  context?: unknown,
): void;
```

### `src/lib/security/headers.ts`

```ts
export type SecurityHeader = { key: string; value: string };

/** The response header table applied to every route by `next.config.ts`. */
export function securityHeaders(options?: {
  isProduction?: boolean;
}): SecurityHeader[];

/** Content-Security-Policy value, derived from the Supabase origin. */
export function contentSecurityPolicy(supabaseUrl: string): string;
```

### `src/lib/security/origin.ts`

```ts
/** Same-origin verdict for a state-changing request. */
export function isTrustedRequestOrigin(
  request: {
    method: string;
    headers: Headers;
    url: string;
  },
  allowedOrigin: string,
): boolean;

/** Paths exempt from the origin gate (signature-verified provider callbacks). */
export const ORIGIN_EXEMPT_PATHS: readonly string[];
```

### `src/lib/security/rate-limit.ts`

```ts
export type RateLimitBucket =
  | "sign_in"
  | "password_reset"
  | "invitation_accept"
  | "password_confirm"
  | "auth_callback"
  | "plaid_webhook";

export type RateLimitVerdict = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

/** Fixed-window counter backed by the service-only RPC. Fails closed. */
export function consumeRateLimit(
  bucket: RateLimitBucket,
  subject: string,
): Promise<RateLimitVerdict>;

/** Stable, non-identifying subject key derived from client IP + optional email. */
export function rateLimitSubject(
  headers: Headers,
  discriminator?: string,
): string;
```

### `e2e/support/fixtures.ts`

```ts
export type FixtureFamily =
  | "auth-owner"
  | "auth-member"
  | "auth-invites"
  | "auth-setup"
  | "auth-expired-session"
  | "plaid"
  | "plaid-repair"
  | "plaid-connection"
  | "plaid-connection-destructive"
  | "categories"
  | "categories-transaction"
  | "dashboard"
  | "budgets"
  | "manual-entries"
  | "data-lifecycle"
  | "data-lifecycle-owner"
  | "data-lifecycle-destructive";

/**
 * Gate a spec on a fixture family. Skips when the family is absent and optional;
 * FAILS when the family is named in `E2E_REQUIRED_FIXTURES`, so missing coverage
 * is visible rather than silent.
 */
export function requireFixture(family: FixtureFamily): void;

/** Resolved credentials for a family, or undefined when it is not provisioned. */
export function fixtureCredentials(
  family: FixtureFamily,
): { email: string; password: string } | undefined;

/** Machine-readable inventory used by the end-of-run coverage reporter. */
export function fixtureInventory(): {
  family: FixtureFamily;
  provisioned: boolean;
  required: boolean;
  missing: string[];
}[];
```

## Acceptance Criteria

### F1 — CI stops overstating coverage

- `.github/workflows/ci.yml` exports `PLAID_E2E_PROVIDER=deterministic` alongside the
  existing Sandbox values, so `e2e/plaid-link.spec.ts` and `e2e/plaid-sync.spec.ts`
  are no longer skipped by their own guard.
- Every `E2E_*` guard across all 11 specs resolves through `e2e/support/fixtures.ts`;
  no spec reads `process.env.E2E_*` directly any more.
- A fixture family named in `E2E_REQUIRED_FIXTURES` that is not provisioned **fails**
  the spec with a message naming the exact missing variables. A family not named
  there still skips, with the same message.
- The suite prints a fixture inventory at the end of a run: each family, whether it
  was provisioned, and whether it was required. A reader can tell what did not run.
- `E2E_REQUIRED_FIXTURES` is documented in `.env.example` and `memory-bank/devSetup.md`.

### F2 — Secure headers and origin/CSRF protection

- Every response carries `Content-Security-Policy`, `Strict-Transport-Security`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and
  `Cross-Origin-Opener-Policy`. `frame-ancestors 'none'` is present in the CSP.
- The CSP `connect-src` admits the configured Supabase origin and Plaid, and admits
  nothing wildcard beyond what those require.
- The existing `/sw.js` header block is preserved exactly — no-store plus
  `Service-Worker-Allowed: /`.
- `src/proxy.ts` rejects a state-changing request (`POST`/`PUT`/`PATCH`/`DELETE`) whose
  `Origin` is present and does not match `APP_URL`, returning 403 without touching
  Supabase. `Sec-Fetch-Site: cross-site` is likewise rejected.
- `/api/plaid/webhook` is exempt from the origin gate: it is a signature-verified
  provider callback and is cross-origin by design. The exemption is an explicit,
  tested allowlist, not an accident of matcher scope.
- The proxy matcher is widened so the gate actually observes API writes.

### F3 — Rate limiting on public auth/invite/webhook routes

- A new migration creates a service-only fixed-window counter table with RLS enabled
  and no authenticated policy, plus a `private` schema function with a pinned
  `search_path` and default execution revoked, following the project's existing
  RLS-helper convention.
- `consumeRateLimit` is applied to `signIn`, `requestPasswordReset`,
  `acceptInvitation`, `resetPassword`, `confirmPassword`, `/auth/confirm`, and
  `/api/plaid/webhook`.
- Exceeding a window returns the surface's ordinary generic error (never "you are rate
  limited on this email address"), so the control cannot be used to enumerate accounts.
  The webhook returns 429 with `Retry-After`.
- The limiter fails **closed** on a database error: a failure to record an attempt
  denies the attempt rather than admitting it.
- pgTAP proves the counter table is unreadable and unwritable by an authenticated role,
  that the window rolls over, and that the RPC is service-role only.

### F4 — Log and error redaction

- `redact` removes values for keys matching token/secret/key/password/credential/
  cookie/authorization/access_token/cursor/amount/balance and sensitive identifier
  names, at any nesting depth, including inside arrays and `Error` objects.
- `redact` also removes secret-_shaped_ values regardless of key name: JWTs,
  `access-sandbox-*`/`access-production-*` Plaid tokens, and long base64/hex secrets.
- Redaction is non-destructive to diagnosis: `error_code`, `error_type`, `request_id`,
  HTTP status, and PostgREST `code` survive, matching the existing `describeCause`
  contract in `src/lib/plaid/errors.ts`.
- Every `console.*` call in server modules routes through `logServerEvent`. A guard
  test fails the build if a raw `console.*` is reintroduced under `src/lib/**`,
  `src/app/api/**`, or `src/proxy.ts`.
- `src/lib/auth/actions.ts` and `src/lib/auth/deletion-queue.ts` no longer log raw
  Supabase error objects.
- No error **response** body carries a token, credential, financial figure, or raw
  internal identifier; existing sanitized messages are preserved.

### F5 — Supply-chain and secret scanning in CI

- A `security` workflow runs `dependency-review-action` on pull requests, a
  `pnpm audit` gate at high severity, and a secret-scanning pass over the full history
  of the pull request range.
- `.github/dependabot.yml` covers npm and GitHub Actions.
- The workflow declares least-privilege `permissions` blocks.

### F6 — Coverage top-ups for the ticket's named gaps

- Domain: accounting signs, refunds netted against category spending, transfers
  excluded from ordinary totals, pending-predecessor reconciliation, filters, budgets,
  and local-timezone day/week/month boundary cases including a DST transition.
- Integration: `/transactions/sync` pagination across multiple pages, added/modified/
  removed mutations, retry after a failed page pass, cursor and claim revalidation,
  webhook signature verification (accepted, wrong-key rejected, malformed rejected,
  explicit `"error": null` accepted), and update-mode state.
- RLS (pgTAP): owner, ordinary member, departed member, Personal owner, unrelated
  user, and service-role, with an explicit assertion that a **Family owner cannot read
  another member's Personal data through ordinary application paths**.
- Auth lifecycle (pgTAP): invitation validity/expiry/revocation/replay, password
  recovery callback state, the 30-day absolute session policy, recent reauthentication,
  and ownership transfer.

### F7 — Accessibility, responsive, and theme browser coverage

- `e2e/security-hardening.spec.ts` asserts on a live response that the security headers
  from F2 are present and that the CSP contains `frame-ancestors 'none'`.
- Structural accessibility checks on the public routes: single `h1`, ordered headings,
  every form control labelled, every image with an alt attribute, skip link as first
  tab stop landing in that route's own `<main>`, and no positive `tabindex`.
- Responsive smoke at 390 / 768 / 1280 asserting no horizontal overflow.
- Both themes are exercised, and the run captures a screenshot per theme.
- No new npm dependency is added for any of this; the committed lockfile is unchanged.

### F8 — Production/Trial smoke checklist and runnable Sandbox script

- `docs/production-smoke-checklist.md` documents the manual Production/Trial procedure:
  what to verify, in what order, what a pass looks like, and what to do on failure.
- `scripts/plaid-sandbox-smoke.mjs` is the runnable Sandbox counterpart of that
  checklist and reports each numbered check with a pass/fail line, still refusing to
  run outside Sandbox.
- The checklist is reachable from `README.md` and `memory-bank/devSetup.md`.

## Out of Scope

- Automating Plaid Link's own UI in blocking CI. The ticket explicitly forbids it; the
  deterministic adapter and the Sandbox token/webhook helpers are the supported path.
- Any new runtime or dev dependency.
- Rewriting the existing passing suites; this ticket adds and closes gaps.

## Verification

`pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and
`pnpm test:e2e` all green, with the fixture inventory printed and no silent skip of a
required family.
