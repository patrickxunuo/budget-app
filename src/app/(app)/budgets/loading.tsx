import {
  RouteSkeleton,
  SkeletonShape,
} from "@/components/app-shell/route-skeleton";

/* Counts are chosen to establish the page's rhythm, not to predict how many
   targets the month holds. */
const SUMMARY_TILES = [0, 1, 2];
const TARGET_ROWS = [0, 1, 2, 3];
const TARGET_STATS = [0, 1, 2, 3];

/**
 * Mirrors the compact budget workbench: scope switch, month control
 * strip, the three-up allocation summary, and the category target rows with
 * their progress meters.
 */
export default function Loading() {
  return (
    <RouteSkeleton
      label="Loading the monthly budgets"
      mainClassName="min-w-0 overflow-x-hidden px-4 py-8 sm:px-8 lg:px-12 lg:py-14"
      containerClassName="mx-auto max-w-7xl"
    >
      <div className="flex justify-end">
        <div className="border-line bg-panel flex gap-1 rounded-full border p-1">
          <SkeletonShape className="h-11 w-24 rounded-full" />
          <SkeletonShape className="h-11 w-24 rounded-full" />
        </div>
      </div>
      <div className="border-line bg-surface mt-3 flex flex-wrap items-center gap-3 rounded-2xl border p-3 sm:p-4">
        <SkeletonShape className="h-11 w-32 rounded-full" />
        <SkeletonShape className="order-first h-7 w-full rounded-lg sm:order-none sm:w-56 sm:flex-1" />
        <SkeletonShape className="h-11 w-28 rounded-full" />
      </div>

      <div className="border-line bg-line mt-6 grid gap-px overflow-hidden rounded-2xl border sm:grid-cols-3">
        {SUMMARY_TILES.map((tile) => (
          <div key={tile} className="bg-surface p-5">
            <SkeletonShape className="h-2.5 w-24 rounded-full" />
            <SkeletonShape className="mt-7 h-8 w-32 max-w-full rounded-lg" />
          </div>
        ))}
      </div>

      <div className="mt-7 flex items-center justify-between gap-4">
        <div className="grid min-w-0 gap-2.5">
          <SkeletonShape className="h-2.5 w-32 max-w-full rounded-full" />
          <SkeletonShape className="h-8 w-52 max-w-full rounded-lg" />
        </div>
        <SkeletonShape className="h-11 w-32 shrink-0 rounded-full" />
      </div>

      <div className="border-line bg-surface mt-5 overflow-hidden rounded-2xl border">
        {TARGET_ROWS.map((row) => (
          <div
            key={row}
            className="border-line grid min-w-0 gap-5 border-t p-5 first:border-t-0 lg:grid-cols-[minmax(10rem,1fr)_minmax(16rem,1.5fr)_auto] lg:items-center"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <SkeletonShape className="size-3 shrink-0 rounded-sm" />
                <SkeletonShape className="h-4 w-32 max-w-full rounded" />
              </div>
              <SkeletonShape className="mt-2.5 h-2.5 w-44 max-w-full rounded-full" />
            </div>
            <div className="min-w-0">
              {/* The track is real furniture; only the filled portion is a
                  placeholder, so the meter still reads as a meter. */}
              <div className="border-line bg-panel h-2 overflow-hidden rounded-full border">
                <SkeletonShape className="h-full w-3/5 rounded-full" />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
                {TARGET_STATS.map((stat) => (
                  <SkeletonShape key={stat} className="h-2.5 rounded-full" />
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <SkeletonShape className="h-9 w-28 rounded-full" />
              <SkeletonShape className="h-9 w-16 rounded-full" />
              <SkeletonShape className="h-9 w-20 rounded-full" />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid max-w-2xl gap-2">
        <SkeletonShape className="h-2.5 rounded-full" />
        <SkeletonShape className="h-2.5 w-3/5 rounded-full" />
      </div>
    </RouteSkeleton>
  );
}
