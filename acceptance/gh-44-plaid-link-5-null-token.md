# GH-44 Plaid Link 5 Null Token - Acceptance Criteria

## Description

Upgrade `react-plaid-link` to 5.x and safely handle its nullable success token. An absent token must stop at the client callback boundary, leave no pending Link state, and return the member to the existing sanitized retry experience; ordinary Item-based success must remain unchanged.

## Interface Contract

### API Endpoints

No API contract changes. A valid success still posts to the existing `POST /api/plaid/exchange` endpoint with:

```ts
{
  publicToken: string;
  institution: {
    id: string;
    name: string;
  }
}
```

A null public token must produce no exchange request.

### Data and State

- Pending Link token key: `budget-app.plaid-link-token` in `sessionStorage`.
- Null success clears that key, does not create review state, and moves the flow to `error`.
- The sanitized status text is: `The secure bank window could not finish. Your accounts were not changed; request a fresh connection and try again.`

### Business Rules

1. `PlaidLinkOnSuccess` may supply `string | null`; null is rejected before `exchange(publicToken: string, ...)`.
2. Null success never reaches `/api/plaid/exchange`, never leaves a pending token, and keeps the member on Accounts with a working retry.
3. A string token exchanges exactly once with the supplied institution id/name.
4. Missing institution metadata retains the existing `unknown-institution` / `Connected institution` fallbacks.
5. The temporary Dependabot major-version ignore is removed after the 5.x upgrade.
6. Other v5 migration items are accounted for: `exit({ force })`, Layer `submit`, and direct `window.Plaid` handler creation are not used; stricter metadata remains null-safe; explicit `usePlaidLink` return types require no integration change.

### UI Component

- Component: `PlaidLinkFlow`.
- Existing selectors remain unchanged: `plaid-status`, `plaid-retry`, `plaid-review`, and `plaid-connect`.
- No visual redesign; preserve the established Accounts dossier styling and accessible live status/retry behavior.

## Frontend Acceptance Tests

| ID       | User/Callback Action                                          | Expected Result                                                                                             |
| -------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| COMP-001 | Invoke captured `onSuccess(null, metadata)` after Link starts | No exchange request; stored token cleared; no review; sanitized error and enabled retry                     |
| COMP-002 | Invoke captured `onSuccess(string, institution)`              | Exactly one exchange request with unchanged token and institution metadata                                  |
| COMP-003 | Invoke captured `onSuccess(string, { institution: null })`    | Exactly one exchange request using existing institution fallbacks                                           |
| E2E-001  | Run deterministic Plaid browser journeys in development mode  | Existing linking, cancellation, review, activation, OAuth retry, responsive and accessibility journeys pass |

## Verification

- BUILD-001: `pnpm build` passes with `react-plaid-link` 5.x.
- QUALITY-001: `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass.
- SMOKE-001: `pnpm smoke:plaid` passes when live Sandbox credentials are available; otherwise record the environmental skip accurately.

## Test Status

- [x] COMP-001: PASS — reproduced red, then zero exchange calls after the guard
- [x] COMP-002: PASS
- [x] COMP-003: PASS
- [ ] E2E-001: Environment unavailable — configured npm launcher fails before Playwright starts; Plaid fixture variables are unset
- [x] BUILD-001: PASS
- [x] QUALITY-001: PASS — lint, typecheck, 894 Vitest checks, build, formatting
- [ ] SMOKE-001: Environment unavailable — `PLAID_ENV` is unset, so the Sandbox-only script refused to create Items
