# Compact Authenticated Pages - Acceptance Criteria

## Description (client-readable)

The authenticated app opens on current financial information instead of repeating editorial introductions. A persistent compact route bar identifies the active page, all six work surfaces begin immediately, and Overview fits its essential month-to-date budget facts in the first phone viewport without changing financial behavior or privacy boundaries.

## Interface Contract

### Authenticated route bar

`src/components/app-shell/route-header.tsx` owns the only visible page-level `h1` for authenticated routes.

- `/dashboard`, `/transactions`, `/budgets`, `/accounts`, `/categories`, and `/settings/members` resolve to `Overview`, `Transactions`, `Budgets`, `Accounts`, `Categories`, and `Family members`.
- Nested paths inherit their owning route name.
- The bar keeps the theme control and a labelled account menu for install guidance, family administration, and sign out.
- It remains mounted across nested route loading and retains sticky, opaque, safe-area-aware shell geometry.

### Route surfaces

- Each authenticated page renders one `main#main-content` and no additional `h1`.
- Repeated eyebrows, display slogans, introductory paragraphs, and large masthead gaps are removed from the six authenticated routes.
- Required privacy, read-only, warning, error, validation, destructive, and empty-state guidance remains beside the action or state it explains.
- Existing API, database, financial-calculation, filtering, mutation, privacy, and error contracts do not change.

### Overview

- Month and Family/Personal scope form the compact context row immediately below the route bar.
- Narrow order is Budget, Accounts, Spending history.
- Wide order is Budget followed by a two-column Spending history and Accounts row.
- Budget exposes spent, target, remaining, pace, and day position without an accordion.
- The chart remains visible at every width. At narrow widths the complete semantic comparison table is inside a native `View daily values` disclosure; at wide widths the same table is expanded.

### Loading and responsive geometry

- The six route loaders mirror the compact destination geometry, contain placeholder shapes only, and do not render a heading.
- The route bar and app shell remain mounted while a nested loader owns `main#main-content` and its existing accessible busy announcement.
- The information hierarchy depends on viewport width, not PWA `display-mode`.
- Primary controls retain 44px touch targets, visible focus, theme contrast, reduced-motion behavior, safe-area padding, and bottom-navigation clearance.

## Frontend Acceptance Tests

| ID     | User Action                                                        | Expected Result                                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FE-001 | Render the authenticated header at each supported pathname.        | The direct route name appears as the only `h1`; unknown nested paths resolve to their owning route; the theme and account actions remain accessible.                                                    |
| FE-002 | Render each authenticated route and its loader.                    | Content has no duplicate `h1`, removed editorial copy is absent, the primary work surface follows the route bar immediately, and loader geometry has no masthead-only block.                            |
| FE-003 | Render Overview with a populated Family model.                     | Month/scope precede Budget; spent, target, remaining, pace, and day position are present; direct section labels replace editorial phrases.                                                              |
| FE-004 | Inspect Overview DOM and responsive styles.                        | Narrow order is Budget, Accounts, Spending history; wide order is Budget then a two-column Spending history/Accounts row.                                                                               |
| FE-005 | Operate `View daily values` by keyboard on narrow Overview.        | The disclosure expands/collapses natively and preserves every table value, caption, row header, and column header; the chart remains visible.                                                           |
| FE-006 | Visit all six authenticated routes at 390px, 768px, and 1280px.    | Exactly one named `h1` is present, removed top copy is absent, the primary work surface enters the initial viewport, and no horizontal overflow occurs.                                                 |
| FE-007 | Visit Overview at 390x844 and 1280x800 with the financial fixture. | The 390x844 first viewport contains current month, scope controls, spent, target, remaining, pace, and day position above the bottom navigation; representative screenshots are attached at both sizes. |
| FE-008 | Navigate between authenticated routes while a nested route loads.  | The route bar and shell remain mounted, the heading updates, the fallback has one empty-mounted status region, and no duplicate heading appears.                                                        |

## Test Status

- [x] FE-001: Passed
- [x] FE-002: Passed
- [x] FE-003: Passed
- [x] FE-004: Passed
- [x] FE-005: Passed
- [x] FE-006: Passed
- [x] FE-007: Passed
- [x] FE-008: Passed

The original flight completed 90 focused and 897 full Vitest checks plus the configured Playwright run with 128 passing cases, 84 optional-fixture skips, and no failures. Recovery verification repeated the focused and full Vitest suites, lint, typecheck, the production build, changed-file formatting, and the Impeccable detector. The focused GH-51 browser project passed 7/7 with retries disabled and attached the required 390x844 and 1280x800 Overview screenshots; FE-007 also passed 3/3 repeated runs after its responsive navigation assertion was made timing-safe. The corrected implementation received an independent `Ready for PR` verdict.
