# GH-32 — Route-level loading skeletons and navigation pending feedback

Acceptance spec and interface contract. Both the test author and the implementer
build against this document; neither invents a name the other has to guess.

## Interface contract

### 1. `src/components/app-shell/skeleton-announcement.tsx` (client)

```tsx
"use client";
export function SkeletonAnnouncement({
  message,
}: {
  message: string;
}): JSX.Element;
```

- Renders `<p role="status" data-testid="route-skeleton-status" className="sr-only">`.
- **Mounts empty and fills its text in an effect.** `memory-bank/systemPatterns.md`
  ("Live regions"): a region inserted with its text already present is not
  announced. This is the documented project pattern, not a stylistic choice.

### 2. `src/components/app-shell/route-skeleton.tsx` (server component — no `"use client"`)

```tsx
export function SkeletonShape({
  className,
}: {
  className: string;
}): JSX.Element;

export function RouteSkeleton(props: {
  label: string; // e.g. "Loading the overview"
  mainClassName: string; // the real route's own <main> classes, verbatim
  containerClassName: string; // the real route's own container, e.g. "mx-auto max-w-7xl"
  children: React.ReactNode;
}): JSX.Element;
```

- `SkeletonShape` renders `<span aria-hidden="true" className={"skeleton block " + className} />`.
  Every placeholder shape in every skeleton goes through it, so no placeholder is
  ever announced as content.
- `RouteSkeleton` renders exactly:

```tsx
<main
  id="main-content"
  tabIndex={-1}
  aria-busy="true"
  data-testid="route-skeleton"
  className={mainClassName}
>
  <SkeletonAnnouncement message={label} />
  <div className={containerClassName}>{children}</div>
</main>
```

### 3. `src/components/app-shell/navigation-pending-indicator.tsx` (client)

```tsx
"use client";
export function NavigationPendingIndicator({
  className,
}: {
  className?: string;
}): JSX.Element;
```

- Reads `const { pending } = useLinkStatus()` — imported from **`next/link`**
  (verified exported in Next 16.3.0; it is _not_ in `next/navigation`).
- Renders `<span data-testid="nav-pending-indicator" data-pending={pending ? "true" : "false"} aria-hidden="true" className={"nav-pending " + className}>`
  containing three `<span className="nav-pending-dot" />` children.
- **Always rendered**, in both states, at a fixed size — never conditionally
  mounted, so it cannot shift the surrounding navigation.

### 4. `src/app/globals.css`

New rules only. **No new colour tokens** — `src/lib/theme/contrast.test.ts` parses
this file and any new token pair enters the gate.

- `.skeleton` — placeholder fill built from `--line-soft`, the decorative-only
  token that is deliberately excluded from the contrast gate.
- `.skeleton::after` — the sweep; `@media (prefers-reduced-motion: reduce)` sets
  `content: none` so the placeholder becomes genuinely static. The existing global
  reduced-motion block only clamps `animation-duration` to `0.01ms`, which would
  freeze a sweep at its _end_ frame rather than remove it.
- `.nav-pending` — fixed box, `opacity: 0`, always occupying its space.
- `.nav-pending[data-pending="true"]` — fades in on a **100ms animation delay** and
  pulses, so a prefetched, effectively-instant transition never flashes.

### 5. Six segment loading files

Each is `export default function Loading()` returning a `RouteSkeleton`. The
`mainClassName` and `containerClassName` must be **copied verbatim** from the real
route, so the skip-link target exists throughout loading and real content does not
shift the layout when it swaps in:

| File                                         | `mainClassName`                                                 | `containerClassName` |
| -------------------------------------------- | --------------------------------------------------------------- | -------------------- |
| `src/app/(app)/dashboard/loading.tsx`        | `min-w-0 overflow-x-hidden px-4 py-8 sm:px-8 lg:px-12`          | `mx-auto max-w-7xl`  |
| `src/app/(app)/accounts/loading.tsx`         | `px-5 py-9 sm:px-8 sm:py-11 lg:px-12 lg:py-14`                  | `mx-auto max-w-6xl`  |
| `src/app/(app)/transactions/loading.tsx`     | `px-5 py-9 sm:px-8 lg:px-12 lg:py-14`                           | `mx-auto max-w-7xl`  |
| `src/app/(app)/budgets/loading.tsx`          | `min-w-0 overflow-x-hidden px-4 py-8 sm:px-8 lg:px-12 lg:py-14` | `mx-auto max-w-7xl`  |
| `src/app/(app)/categories/loading.tsx`       | `px-5 py-9 sm:px-8 lg:px-12 lg:py-14`                           | `mx-auto max-w-6xl`  |
| `src/app/(app)/settings/members/loading.tsx` | `px-5 py-10 sm:px-8 lg:px-12`                                   | `mx-auto max-w-5xl`  |

Structure each skeleton must mirror (placeholder shapes only):

- **dashboard** — header block, scope/period control strip, summary tiles row, chart area, account panel, transaction rows
- **accounts** — header block, sync-status strip, connection cards, a link-flow footer block
- **transactions** — header block, scope pill row, three-cell summary band, manual register, ledger rows
- **budgets** — header block, month control strip, category target rows
- **categories** — header block, category list, rule register
- **settings/members** — header block, roster rows, an invitation block

### 6. `src/app/loading.tsx`

Restyled into the same visual language, keeping its cold-boot full-viewport shape
(it sits _above_ `(app)/layout.tsx` and must not pretend to be a route skeleton).
Renders `<main id="main-content" tabIndex={-1} aria-busy="true" data-testid="root-loading">`
with `SkeletonShape` placeholders and a `SkeletonAnnouncement`. It must **not**
carry `data-testid="route-skeleton"`, so coverage can tell the two apart.

### 7. `src/app/(app)/layout.tsx`

One addition: `data-testid="workspace-header"` on the existing `<header>`, so a
browser assertion can prove the header stays pinned during a transition. Nothing
else in that file changes.

## Acceptance criteria → checks

**Route transitions**

- AC1 Each of the six authenticated destinations has its own segment-level loading file.
- AC2 During a tab switch the rail, bottom bar, and workspace header stay mounted and interactive; the shell is never blanked.
- AC3 Visible feedback appears within 100ms of activating a navigation item, for all six destinations. (The prefetched route-level fallback is the primary feedback; it renders on commit.)
- AC4 Navigation is interruptible — activating a second destination while one is pending resolves to the second.

**Skeleton fidelity**

- AC5 Each skeleton mirrors its route's real structure, not a generic spinner.
- AC6 Each skeleton reproduces `<main id="main-content" tabIndex={-1}>` plus its route's own container max-width and padding.
- AC7 No fabricated figures, currency symbols, account/merchant/category names — placeholder shapes only.
- AC8 Skeleton motion honours `prefers-reduced-motion`; reduced motion yields a static placeholder, not a frozen sweep.
- AC9 Skeletons expose a polite busy state to AT (`aria-busy` + a `role="status"` region that mounts empty); placeholder shapes are `aria-hidden`.

**Navigation pending affordance**

- AC10 The activated item shows a pending affordance in both the rail and the bottom bar.
- AC11 The affordance occupies fixed space and never shifts the surrounding layout.
- AC12 It is visually distinct from the `aria-current` active indicator (solid bar vs. three-dot cluster) and does not rely on colour alone.
- AC13 A prefetched, effectively-instant transition shows no flash of pending state (100ms animation delay).

**Root loader**

- AC14 `src/app/loading.tsx` is restyled into the route-skeleton visual language.
- AC15 It appears on a cold shell load and does not appear when switching between authenticated routes.

**Quality**

- AC16 No skeleton introduces horizontal overflow at 390px, 768px, or 1280px.
- AC17 Browser coverage asserts, for at least two routes under a throttled navigation, that the shell remains mounted and the route skeleton is displayed.
- AC18 Palette contrast gate, lint, typecheck, production build, and the existing browser baseline stay green.

## Out of scope (from the ticket)

Mutating-control pending/busy/disabled states (that is #33), the five public
`(auth)` routes, data-fetch performance, prefetch strategy, and any change to page
content, layout, or accounting behaviour.
