# Standardize Pending and Disabled States - Acceptance Criteria

## Description (client-readable)

Every in-page financial mutation gives immediate, consistent feedback and cannot be submitted twice while it is running. The shared treatment keeps labels stable in the layout, announces progress accessibly, restores controls after failures, and preserves every existing behavior and error message.

## Interface Contract

This is the shared agreement between the Test Writer and the Implementer. Both agents receive this full acceptance spec, including this contract, but not each other's code.

### API Endpoints

No API contract changes are allowed. Existing mutation and read endpoints, bodies, success payloads, status codes, validation, and sanitized errors remain unchanged.

### Shared hook

`src/hooks/use-pending-action.ts` exports `usePendingAction(options?)`.

- `options.strategy` is `"exclusive"` by default and may be `"latest"` for the GH-30 transaction explorer's superseding read requests.
- The hook returns `{ pending, run }`. `pending` is the only request-in-flight boolean a surface owns.
- `run(action)` sets `pending` before invoking the async action and clears it in `finally` on success, handled failure, thrown error, or network error.
- Under `exclusive`, a synchronous ref guard ignores repeat activation even before React commits the pending render; an ignored call does not invoke `action` and resolves to `undefined`.
- Under `latest`, new work may supersede old work. Only the most recently started action may clear `pending`; a stale completion cannot make the latest request appear idle.
- Errors are not swallowed by the hook. Existing surface handlers keep their current sanitized error behavior.

### Shared pending button

`src/components/pending-button.tsx` exports `PendingButton`, accepting normal button props plus required `pending: boolean` and `pendingLabel: ReactNode`.

- It preserves the caller's `className`, `data-testid`, label, button type, and pre-existing disabled condition.
- It is disabled when either the caller disables it or `pending` is true, exposes `aria-busy="true"` only while pending, and exposes `data-pending="true|false"` for styling and tests.
- Idle and pending labels remain mounted in the same grid cell so the larger state reserves the button's footprint and activation never shifts nearby layout.
- The visible pending state includes text and an animated, non-colour-only dot affordance marked `aria-hidden`.
- One always-mounted polite status node announces the pending label only while pending.
- The dot motion is removed, not merely shortened, under `prefers-reduced-motion: reduce`.

### Surface contracts

One hook instance is used per adopting surface. While its mutation is pending, every mutating control on that surface is disabled, while non-mutating cancellation may remain available when safe.

| Surface                  | Existing test ids preserved                        | Pending actions and labels                                                                                                                                                  |
| ------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transaction ledger       | `category-save-*`, `rule-create-*`, `rule-confirm` | one-off save / `Saving…`; rule preview / `Checking matches…`; rule creation / `Creating rule…`                                                                              |
| Plaid connection manager | all `plaid-*` ids                                  | visibility / `Applying visibility…`; reconcile / `Reconciling…`; update-token / `Preparing update…`; destructive disconnect / `Disconnecting…`                              |
| Budget workbench         | all `budget-*` ids, especially `budget-loading`    | view refresh / `Updating…`; target save / `Saving…`; archive / `Archiving…`                                                                                                 |
| Category workbench       | `category-submit` and existing register controls   | create / `Saving…`; archive / `Archiving…`                                                                                                                                  |
| Manual/Cash workbench    | all `manual-entry-*` ids                           | create/edit / `Recording…`; delete / `Removing…`                                                                                                                            |
| Transaction explorer     | `transactions-loading` and all filter/export ids   | effect-driven refetch uses the hook's `latest` strategy, keeps the existing supersession/unmount guards, and preserves its current visible loading copy and export behavior |

`auth-form.tsx`, `membership-console.tsx`, `plaid-sync-status.tsx`, and `financial-dashboard.tsx` remain unchanged. No optimistic UI, API/RPC, server serialization, or client-idempotency-key work is included.

## Business Rules

1. A surface has one pending state. Starting any mutation disables all of that surface's mutating controls, including controls on other rows.
2. Repeat activation during an exclusive action issues no second fetch, including two clicks in the same event turn.
3. Pending always settles after success, a handled non-2xx response, thrown parsing error, or network rejection.
4. Existing success copy, validation behavior, sanitized failure copy, test ids, and mutation semantics are unchanged.
5. Plaid disconnect is protected by the same surface-wide guard before the provider-boundary request starts.
6. `plaid-sync-status.tsx` retains its deliberate per-item keyed pending model.
7. The transaction explorer retains its latest-request-wins and unmount safety; adopting the shared name must not prevent rapid filter supersession.
8. The shared button uses existing colour tokens and typography rather than introducing a new visual language.

## Frontend Acceptance Tests

| ID     | User Action                                                              | Expected Result                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FE-001 | Invoke the shared hook and immediately invoke it again                   | The exclusive action runs once; pending is true during work and false after resolve or reject                                                                                           |
| FE-002 | Toggle a `PendingButton` between idle and pending                        | Both labels reserve one footprint; disabled, `aria-busy`, polite announcement, dots, caller props, and reduced-motion CSS are correct                                                   |
| FE-003 | Save, preview, and create a rule in the transaction ledger               | The active action shows its pending label, all ledger mutation buttons disable, a repeat click makes one request, and failure restores controls with existing error copy                |
| FE-004 | Change Plaid visibility and confirm disconnect                           | The whole connection surface disables, the active control identifies progress, double disconnect makes one provider-boundary request, and failure restores controls with sanitized copy |
| FE-005 | Refresh/save/archive in budgets and create/archive a category            | Each workbench uses one pending state, preserves existing copy and ids, blocks repeat requests, and recovers after failure                                                              |
| FE-006 | Create/edit/delete a Manual/Cash entry                                   | The surface shows the appropriate pending label, disables its mutation controls, issues one request on repeat activation, and retains form/error behavior after failure                 |
| FE-007 | Rapidly change transaction explorer filters and unmount during a request | Latest-response-wins, URL/export snapshot, retained-error behavior, and cleanup remain unchanged while the shared pending state settles correctly                                       |
| FE-008 | Inspect every adopting surface with motion allowed and reduced           | Pending is conveyed by text plus shape, announced politely, does not shift control geometry, and animated dots become static under reduced motion                                       |

## Browser Acceptance Direction

- Extend existing real-backend Playwright flows only where current fixtures can prove pending/disabled behavior without API interception or fake responses.
- The critical browser target is destructive Plaid disconnect when its disposable fixture is available; component coverage remains authoritative for deterministic double-click and network-failure timing.
- Preserve the existing browser baseline and screenshot artifact contract.

## Test Status

- [x] FE-001: PASS
- [x] FE-002: PASS
- [x] FE-003: PASS
- [x] FE-004: PASS
- [x] FE-005: PASS
- [x] FE-006: PASS
- [x] FE-007: PASS
- [x] FE-008: PASS

Component acceptance is green in the focused 49-test run and the complete 909-test Vitest run. The one configured full Playwright run was attempted after adding real-DOM pending observers, but the GH-33 categories/Plaid journeys were fixture-skipped and the overall suite failed at pre-existing protected/setup routes because this worktree had no Supabase/server environment values. During review, the fixtureless focused FE-008 browser check passed in desktop Chromium against the app's compiled CSS, proving unchanged button bounds during the observed pending transition, active dot animation with motion allowed, `animation-name: none` under reduced motion, and the representative shared-button contract for every adopting mutation surface; the transaction explorer retains its separate polite text status.
