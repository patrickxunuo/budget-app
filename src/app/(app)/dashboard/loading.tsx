import {
  RouteSkeleton,
  SkeletonShape,
} from "@/components/app-shell/route-skeleton";

/* Counts are chosen to establish the page's rhythm, not to predict how much
   data will arrive. */
const SUMMARY_TILES = [0, 1, 2];
const CADENCE_BARS = ["h-12", "h-20", "h-14", "h-24", "h-10", "h-28", "h-16"];
const CADENCE_ROWS = [0, 1, 2];
const ACCOUNT_NOTES = [0, 1];
const TRANSACTION_ROWS = [0, 1, 2, 3];

/**
 * Mirrors today's `FinancialDashboard`: masthead and scope switch, the period
 * control strip, the four-up summary band, the cadence chart beside the
 * provider balance panel, and the transaction register.
 */
export default function Loading() {
  return (
    <RouteSkeleton
      label="Loading the overview"
      mainClassName="min-w-0 overflow-x-hidden px-4 py-8 sm:px-8 lg:px-12"
      containerClassName="mx-auto max-w-7xl"
    >
      <div className="border-line grid gap-6 border-b pb-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <SkeletonShape className="h-3 w-64 max-w-full rounded-full" />
          <div className="mt-4 grid max-w-3xl gap-3">
            <SkeletonShape className="h-10 rounded-lg sm:h-12" />
            <SkeletonShape className="h-10 w-4/5 rounded-lg sm:h-12" />
          </div>
          <div className="mt-5 grid max-w-2xl gap-2.5">
            <SkeletonShape className="h-2.5 rounded-full" />
            <SkeletonShape className="h-2.5 w-3/4 rounded-full" />
          </div>
        </div>
        <div className="border-line bg-panel flex w-fit gap-1 rounded-full border p-1">
          <SkeletonShape className="h-9 w-24 rounded-full" />
          <SkeletonShape className="h-9 w-24 rounded-full" />
        </div>
      </div>

      <div className="border-line bg-surface mt-6 rounded-2xl border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SkeletonShape className="h-9 w-16 rounded-full" />
          <SkeletonShape className="h-9 w-16 rounded-full" />
          <SkeletonShape className="h-9 w-20 rounded-full" />
          <SkeletonShape className="h-9 w-20 rounded-full" />
          <SkeletonShape className="h-9 w-24 rounded-full sm:ml-auto" />
          <SkeletonShape className="h-9 w-20 rounded-full" />
        </div>
        <SkeletonShape className="mt-5 h-7 w-72 max-w-full rounded-lg" />
      </div>

      <div className="border-line bg-line mt-6 grid gap-px overflow-hidden rounded-2xl border sm:grid-cols-2 lg:grid-cols-4">
        {SUMMARY_TILES.map((tile) => (
          <div key={tile} className="bg-surface p-5">
            <SkeletonShape className="h-2.5 w-24 rounded-full" />
            <SkeletonShape className="mt-8 h-8 w-32 max-w-full rounded-lg" />
          </div>
        ))}
        <div className="bg-panel p-5">
          <SkeletonShape className="h-2.5 w-20 rounded-full" />
          <SkeletonShape className="mt-8 h-8 w-40 max-w-full rounded-lg" />
        </div>
      </div>

      <div className="mt-8 grid min-w-0 gap-6 lg:grid-cols-[1.45fr_.75fr]">
        <div className="border-line bg-surface min-w-0 rounded-2xl border p-5">
          <SkeletonShape className="h-7 w-56 max-w-full rounded-lg" />
          <div className="mt-5 flex h-28 items-end gap-2">
            {CADENCE_BARS.map((height) => (
              <SkeletonShape
                key={height}
                className={`flex-1 rounded-t rounded-b-none ${height}`}
              />
            ))}
          </div>
          <div className="mt-5 grid gap-3">
            {CADENCE_ROWS.map((row) => (
              <div key={row} className="grid grid-cols-3 gap-4">
                <SkeletonShape className="h-2.5 rounded-full" />
                <SkeletonShape className="h-2.5 rounded-full" />
                <SkeletonShape className="h-2.5 rounded-full" />
              </div>
            ))}
          </div>
        </div>
        <div className="border-line bg-panel min-w-0 rounded-2xl border p-5">
          <SkeletonShape className="h-7 w-52 max-w-full rounded-lg" />
          {ACCOUNT_NOTES.map((note) => (
            <div key={note} className="border-line mt-4 border-t pt-4">
              <SkeletonShape className="h-4 w-40 max-w-full rounded" />
              <SkeletonShape className="mt-2.5 h-6 w-32 max-w-full rounded" />
              <SkeletonShape className="mt-2.5 h-2.5 w-36 max-w-full rounded-full" />
              <SkeletonShape className="mt-2 h-2.5 w-28 max-w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>

      <div className="border-line bg-surface mt-6 w-full max-w-full overflow-x-hidden rounded-2xl border">
        <div className="p-5">
          <SkeletonShape className="h-7 w-64 max-w-full rounded-lg" />
        </div>
        {TRANSACTION_ROWS.map((row) => (
          <div
            key={row}
            className="border-line grid gap-2 border-t p-5 sm:grid-cols-[1fr_auto] sm:items-start"
          >
            <div className="grid min-w-0 gap-2.5">
              <SkeletonShape className="h-4 w-48 max-w-full rounded" />
              <SkeletonShape className="h-2.5 w-full max-w-sm rounded-full" />
              <SkeletonShape className="h-2.5 w-3/5 max-w-xs rounded-full" />
            </div>
            <SkeletonShape className="h-6 w-24 rounded sm:justify-self-end" />
          </div>
        ))}
      </div>
    </RouteSkeleton>
  );
}
