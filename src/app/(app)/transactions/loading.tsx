import {
  RouteSkeleton,
  SkeletonShape,
} from "@/components/app-shell/route-skeleton";

/* Counts are chosen to establish the page's rhythm, not to predict how much
   activity the scope holds. */
const SUMMARY_CELLS = [0, 1, 2];
const MANUAL_FIELDS = [0, 1, 2, 3];
const MANUAL_ENTRIES = [0, 1, 2];
const LEDGER_ROWS = [0, 1, 2, 3];

/**
 * Mirrors the ledger: masthead, the scope pill pair, the three-cell scoped
 * summary, the Manual/Cash desk beside its register, and the Plaid rows.
 */
export default function Loading() {
  return (
    <RouteSkeleton
      label="Loading the ledger"
      mainClassName="px-5 py-9 sm:px-8 lg:px-12 lg:py-14"
      containerClassName="mx-auto max-w-7xl"
    >
      <div className="mb-9 grid gap-5 lg:grid-cols-[1fr_22rem] lg:items-end">
        <div>
          <SkeletonShape className="h-3 w-60 max-w-full rounded-full" />
          <div className="mt-4 grid max-w-3xl gap-3">
            <SkeletonShape className="h-10 rounded-lg sm:h-12" />
            <SkeletonShape className="h-10 w-2/3 rounded-lg sm:h-12" />
          </div>
        </div>
        <div className="border-line grid gap-2.5 border-l pl-5">
          <SkeletonShape className="h-2.5 rounded-full" />
          <SkeletonShape className="h-2.5 rounded-full" />
          <SkeletonShape className="h-2.5 w-3/4 rounded-full" />
        </div>
      </div>

      <div className="border-line bg-panel mb-6 flex w-fit gap-1 rounded-full border p-1">
        <SkeletonShape className="h-9 w-24 rounded-full" />
        <SkeletonShape className="h-9 w-24 rounded-full" />
      </div>

      <div className="border-line bg-panel mb-9 grid overflow-hidden rounded-2xl border sm:grid-cols-3">
        {SUMMARY_CELLS.map((cell) => (
          <div
            key={cell}
            className="border-line px-5 py-4 not-last:border-b sm:not-last:border-r sm:not-last:border-b-0"
          >
            <SkeletonShape className="h-2.5 w-32 max-w-full rounded-full" />
            <SkeletonShape className="mt-3 h-7 w-28 max-w-full rounded-lg" />
          </div>
        ))}
        <div className="border-line col-span-full grid gap-2.5 border-t px-5 py-3">
          <SkeletonShape className="h-2.5 rounded-full" />
          <SkeletonShape className="h-2.5 w-2/3 rounded-full" />
        </div>
      </div>

      <div className="mb-16 grid gap-8 xl:grid-cols-[minmax(19rem,24rem)_minmax(0,1fr)] xl:items-start">
        <div className="border-line bg-panel overflow-hidden rounded-[1.75rem] border p-5 shadow-[0_18px_55px_rgba(30,46,39,.07)] sm:p-6">
          <SkeletonShape className="h-2.5 w-36 rounded-full" />
          <SkeletonShape className="mt-3 h-8 w-52 max-w-full rounded-lg" />
          <div className="mt-4 grid gap-2.5">
            <SkeletonShape className="h-2.5 rounded-full" />
            <SkeletonShape className="h-2.5 w-4/5 rounded-full" />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <SkeletonShape className="h-2.5 w-16 rounded-full" />
              <SkeletonShape className="h-11 rounded-xl" />
            </div>
            <div className="grid gap-2">
              <SkeletonShape className="h-2.5 w-20 rounded-full" />
              <SkeletonShape className="h-11 rounded-xl" />
            </div>
          </div>
          <div className="mt-4 grid gap-4">
            {MANUAL_FIELDS.map((field) => (
              <div key={field} className="grid gap-2">
                <SkeletonShape className="h-2.5 w-24 rounded-full" />
                <SkeletonShape className="h-11 rounded-xl" />
              </div>
            ))}
          </div>
          <SkeletonShape className="mt-6 h-11 w-full rounded-full" />
        </div>

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <div className="grid gap-2.5">
              <SkeletonShape className="h-2.5 w-40 max-w-full rounded-full" />
              <SkeletonShape className="h-8 w-56 max-w-full rounded-lg" />
            </div>
            <SkeletonShape className="h-10 w-36 rounded-full" />
          </div>
          <div className="border-line divide-line grid divide-y overflow-hidden rounded-2xl border">
            {MANUAL_ENTRIES.map((entry) => (
              <div
                key={entry}
                className="bg-surface grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div className="grid min-w-0 gap-2.5">
                  <SkeletonShape className="h-4 w-48 max-w-full rounded" />
                  <SkeletonShape className="h-2.5 w-full max-w-xs rounded-full" />
                </div>
                <SkeletonShape className="h-6 w-24 rounded sm:justify-self-end" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-line border-t pt-10">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
          <SkeletonShape className="h-8 w-48 max-w-full rounded-lg" />
          <SkeletonShape className="h-2.5 w-56 max-w-full rounded-full" />
        </div>
        <div className="border-line grid gap-4 overflow-hidden rounded-2xl border md:block md:gap-0">
          <div className="bg-panel hidden grid-cols-[minmax(12rem,1.5fr)_1fr_1fr_minmax(14rem,1.2fr)] gap-4 px-5 py-3 md:grid">
            <SkeletonShape className="h-2.5 w-24 rounded-full" />
            <SkeletonShape className="h-2.5 w-20 rounded-full" />
            <SkeletonShape className="h-2.5 w-16 rounded-full" />
            <SkeletonShape className="h-2.5 w-24 rounded-full" />
          </div>
          {LEDGER_ROWS.map((row) => (
            <div
              key={row}
              className="border-line bg-surface grid gap-4 border-b p-5 last:border-b-0 md:grid-cols-[minmax(12rem,1.5fr)_1fr_1fr_minmax(14rem,1.2fr)] md:items-center"
            >
              <div className="grid min-w-0 gap-2.5">
                <SkeletonShape className="h-5 w-40 max-w-full rounded" />
                <SkeletonShape className="h-2.5 w-32 max-w-full rounded-full" />
              </div>
              <SkeletonShape className="h-3.5 w-28 max-w-full rounded-full" />
              <div className="grid gap-2">
                <SkeletonShape className="h-3.5 w-24 max-w-full rounded-full" />
                <SkeletonShape className="h-2.5 w-16 rounded-full" />
              </div>
              <div className="min-w-0">
                <SkeletonShape className="h-11 rounded-lg" />
                <div className="mt-2 flex flex-wrap gap-2">
                  <SkeletonShape className="h-9 w-28 rounded-full" />
                  <SkeletonShape className="h-9 w-28 rounded-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </RouteSkeleton>
  );
}
