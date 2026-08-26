# Spending History Axes and Interactive Readings - Acceptance Criteria

## Description (client-readable)

The Overview spending-history chart explains its time and money scales at a glance and lets a household inspect the nearest available day with a mouse, keyboard, or touch. Exact readings remain neutral, accessible, and consistent with the existing complete daily-values table.

## Interface Contract

This is the shared agreement between the Test Writer and the Implementer. It covers a bounded client-side refinement; dashboard API, read-model, and spending-calculation semantics do not change.

### API Endpoints

None. Continue consuming `DashboardOverviewReadModel["comparison"]["points"]` from the existing dashboard response.

### Data Models

Each existing comparison point has:

- `day: number` — one-based calendar day.
- `date: string` — ISO `YYYY-MM-DD`, interpreted in UTC for display.
- `currentCumulativeCents: number` — current-month cumulative CAD cents; may be negative.
- `baselineAverageCents: number | null` — baseline cumulative CAD cents when history exists.

The chart domain is day 1 through the latest available point day. The Y domain always includes zero and expands below zero when either series contains a negative value.

### Business Rules

1. Show approximately 5–6 X ticks on wide layouts and 3–4 on narrow layouts, always including day 1 and the latest available day. Do not project beyond the latest point.
2. Label the X axis `Day of month` and the Y axis `Cumulative spending (CAD)`.
3. Generate rounded Y ticks that include zero and format compact CAD labels such as `$0`, `$500`, and `$1k`; horizontal gridlines align exactly with these ticks and no persistent vertical gridlines are rendered.
4. The plot is the interaction target. Pointer position snaps to the closest available point by day/X coordinate.
5. Mouse hover is temporary and clears on pointer leave. Touch selects and pins a point until another point is selected or a pointer/touch starts outside the chart.
6. Focusing the plot exposes a reading; Left/Down and Right/Up move through available points, clamped at the ends. Escape dismisses it.
7. An active reading renders one vertical guide, one current-series marker, and a baseline marker only when that point has a baseline.
8. The tooltip contains the selected date and current cumulative amount. When baseline exists, it also contains the baseline amount and neutral `$X above baseline`, `$X below baseline`, or `$0 at baseline` copy. Never use good/bad or red/green language.
9. When baseline is unavailable, omit both the baseline and comparison rows rather than rendering an unavailable placeholder.
10. The tooltip is absent before interaction. The active reading is exposed through an associated polite status for assistive technology.
11. Preserve the existing `View daily values` native disclosure and its complete semantic table.
12. Single-point data, all-null baselines, negative ranges, and narrow layouts remain readable without changing the dashboard read model.

### UI Components

- Existing component: `FinancialDashboard` in `src/components/dashboard/financial-dashboard.tsx`.
- Existing chart section: `data-testid="dashboard-comparison-chart"`.
- Interactive plot target: `data-testid="dashboard-comparison-plot"`, keyboard focusable, with an accessible name describing spending history inspection.
- Axis titles: `data-testid="dashboard-comparison-x-axis-title"` and `data-testid="dashboard-comparison-y-axis-title"`.
- Tick labels: `data-testid="dashboard-comparison-x-tick"` and `data-testid="dashboard-comparison-y-tick"` (repeated elements).
- Active guide: `data-testid="dashboard-comparison-guide"`.
- Active current marker: `data-testid="dashboard-comparison-active-current-marker"`.
- Active baseline marker: `data-testid="dashboard-comparison-active-baseline-marker"`, only when available.
- Visual tooltip: `data-testid="dashboard-comparison-tooltip"`, rendered only while a reading is active.
- Assistive reading: `data-testid="dashboard-comparison-reading"`, an always-mounted polite status whose text is empty until a reading is active.
- Existing fallback: `data-testid="dashboard-daily-values-disclosure"` and `data-testid="dashboard-comparison-table"` remain unchanged and complete.

## API Acceptance Tests

Not applicable; no API contract changes.

## Frontend Acceptance Tests

| ID     | User Action                                                      | Expected Result                                                                                                                                                                                |
| ------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FE-001 | Render a multi-day chart at wide and narrow responsive densities | Both titled axes appear; day 1/latest are present; wide has approximately 5–6 X labels, narrow 3–4; rounded compact-CAD Y labels align with horizontal gridlines and there is no vertical grid |
| FE-002 | Render zero-positive and negative-to-positive data               | Zero is always included, negative ticks appear only when required, and compact CAD labels remain readable                                                                                      |
| FE-003 | Move the mouse across the plot and then leave                    | The nearest day is selected with guide/available markers and complete neutral tooltip; leaving clears the temporary reading                                                                    |
| FE-004 | Select by touch, interact again inside, then outside             | Touch pins the nearest reading, another in-plot touch changes it, and an outside interaction dismisses it                                                                                      |
| FE-005 | Focus the plot, use arrow keys, and press Escape                 | Focus exposes a reading, arrows move/clamp through available days, Escape dismisses, and the polite assistive reading matches the active tooltip                                               |
| FE-006 | Inspect a point without baseline history                         | Baseline legend/context may remain, but the active tooltip has no baseline row, no delta row, and no active baseline marker                                                                    |
| FE-007 | Render one available point                                       | Both axes remain meaningful, the existing static point marker remains visible, and all pointer/keyboard readings snap safely to that point                                                     |
| FE-008 | Open `View daily values` after chart interactions                | The same complete native disclosure/table remains available with every comparison point                                                                                                        |

## Test Status

- [x] FE-001: PASS
- [x] FE-002: PASS
- [x] FE-003: PASS
- [x] FE-004: PASS
- [x] FE-005: PASS
- [x] FE-006: PASS
- [x] FE-007: PASS
- [x] FE-008: PASS

All eight cases pass in the 16-check dashboard component suite. The two real-backend Playwright journeys are authored for desktop and mobile; the focused run registered all four project cases and skipped them because the dashboard fixture credentials were not provisioned in this worktree.
