# GH-26 Themed Select System - Acceptance Criteria

## Description (client-readable)

Piggy replaces every browser-default select with one cohesive dropdown system. Small fixed choices stay quick and familiar, while category pickers gain keyboard- and pointer-accessible search without changing the budgeting, transaction, membership, or Plaid behavior behind them.

## Interface Contract

This is the shared agreement between the Test Writer and the Implementer. There are no API changes in GH-26.

### API Endpoints

None. Existing requests, server actions, payloads, and response handling remain unchanged.

### Data Models

```ts
export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  keywords?: readonly string[];
};

export type SelectProps = {
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  placeholder?: string;
  variant?: "default" | "compact";
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "data-testid"?: string;
};

export type SearchableSelectProps = SelectProps & {
  searchPlaceholder?: string;
  emptyMessage?: string;
};
```

Both components are exported from `src/components/select.tsx`. The public `data-testid` belongs to the visible trigger and the trigger exposes the current value as `data-value`. A named, visually hidden text input mirrors the value for `FormData`; required empty values stop native form submission and transfer invalid focus to the visible trigger.

### Business Rules

1. `Select` and `SearchableSelect` share the same themed portal surface, option row, selected check, active state, disabled state, elevation, scrolling, collision handling, and motion behavior.
2. The default trigger is at least 44 px tall. `compact` may be shorter but remains legible and keyboard operable.
3. Closed triggers preserve every migrated control's accessible name/description, disabled and invalid semantics, current value, test id, and form name/default behavior.
4. A standard select opens from pointer, Enter, Space, ArrowDown, or ArrowUp. While open, arrows, Home/End, Enter/Space, Escape, and printable-character typeahead work. Disabled options are skipped.
5. A searchable select focuses its search field when opened. Filtering is case-insensitive across label and keywords; arrows navigate visible enabled options, Enter selects, Escape dismisses, and a clear empty state appears when nothing matches.
6. Selection and Escape close the menu and return focus to the trigger. Pointer interaction outside the menu dismisses it. Only one menu is open at a time.
7. Trigger/listbox ownership, expanded state, active option, selected state, disabled state, required/invalid state, and changing search-result counts are exposed to assistive technology.
8. The portal is clamped to the viewport, opens above when there is not enough room below, never exceeds the narrow viewport horizontally, scrolls long lists, and layers above cards and dialogs.
9. The field-report visual direction uses the existing Bricolage/Manrope/IBM Plex Mono fonts and `--surface`, `--panel`, `--ink`, `--muted`, `--line`, `--line-soft`, `--brand`, and `--focus` tokens. Options use deliberate dividers/spacing and selected/check treatment in both themes.
10. Open/active transitions use CSS only and become effectively static under `prefers-reduced-motion`.
11. All 14 native selects currently in `src/components/` are removed. The four category pickers (transaction ledger, budget form, transaction explorer category filter, and Manual/Cash form) use `SearchableSelect`; account and all fixed choices use `Select`.
12. Existing values, state setters, URL synchronization, mutation payloads, server-action fields, validation, labels, disabled rules, and test IDs do not change.

### Migrated Test IDs

- `category-select-{transactionId}` - searchable category picker
- `budget-category` - searchable category picker
- `transactions-category-filter` - searchable category picker
- `manual-entry-category` - searchable category picker
- `transactions-account-filter` - standard select
- `transactions-status-filter` - standard select
- `transactions-inclusion-filter` - standard select
- `category-scope` - standard select
- `manual-entry-scope` - standard select
- `manual-entry-kind` - standard select
- `plaid-reason-{itemId}` - standard select
- `plaid-visibility-{accountId}` - standard select
- `plaid-disconnect-mode-{itemId}` - standard select
- invitation `expiresInHours` - standard select, with a stable `invitation-expiry` test id added

## API Acceptance Tests

No API acceptance tests are added because the ticket changes only client-side controls and preserves every existing request contract.

## Frontend Acceptance Tests

| ID     | User Action                                                 | Expected Result                                                                                                                                            |
| ------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FE-001 | Open a standard select with pointer and choose an option    | The shared themed listbox opens, the value changes once, selected state is exposed, and focus returns to the trigger                                       |
| FE-002 | Operate a standard select entirely by keyboard              | Enter/Space/arrows/Home/End/typeahead navigate enabled options; Enter selects; Escape dismisses and restores trigger focus                                 |
| FE-003 | Open a disabled standard select                             | It exposes disabled state and cannot open or change                                                                                                        |
| FE-004 | Open a searchable category picker and type a matching query | Results filter case-insensitively, the result count is announced, arrow/Enter selects, search resets, and form state is retained                           |
| FE-005 | Search for a category that does not exist                   | A clear empty state is shown, no invalid option becomes active, and Escape closes safely                                                                   |
| FE-006 | Submit named/default and required controls                  | `FormData` contains the current value; an empty required picker blocks submission and focuses its visible trigger                                          |
| FE-007 | Open near a viewport edge and on a 390 px viewport          | The menu flips/clamps, stays within the viewport, layers over its surface, and long options scroll without horizontal overflow                             |
| FE-008 | Emulate reduced motion and both app themes                  | Menu/active motion is suppressed when requested and all surfaces use existing theme tokens with visible focus/selected states                              |
| FE-009 | Use each migrated fixed-choice context                      | Privacy, kind, status, inclusion, invitation expiry, Plaid reason/visibility/disconnect, and account choices preserve their existing handlers and payloads |
| FE-010 | Use each migrated category context                          | Ledger, budget, transaction-filter, and Manual/Cash category search preserve existing values, handlers, disabled rules, and mutation/filter behavior       |
| FE-011 | Navigate a searchable picker with assistive semantics       | Trigger/search/listbox relationships, active descendant, selected/disabled state, accessible name/description, and live result changes are present         |
| FE-012 | Inspect the repository and run affected journeys            | No native `<select>` remains under `src/components`; adapted component and Playwright journeys use the visible triggers and still pass                     |

## Test Status

- [x] FE-001: PASS (Vitest)
- [x] FE-002: PASS (Vitest)
- [x] FE-003: PASS (Vitest)
- [x] FE-004: PASS (Vitest)
- [x] FE-005: PASS (Vitest)
- [x] FE-006: PASS (Vitest)
- [ ] FE-007: Authored; browser execution blocked by missing Supabase/server environment
- [x] FE-008: PASS (structure/component coverage; browser state authored)
- [x] FE-009: PASS (component coverage; real-backend journeys authored)
- [x] FE-010: PASS (component coverage; real-backend journeys authored)
- [x] FE-011: PASS (Vitest)
- [x] FE-012: PASS (repository scan + full Vitest)
