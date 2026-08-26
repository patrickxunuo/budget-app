import {
  RouteSkeleton,
  SkeletonShape,
} from "@/components/app-shell/route-skeleton";

const PERIOD_PILLS = [0, 1, 2, 3];
const EXPLORER_FILTERS = [0, 1, 2, 3, 4];
const EXPLORER_ROWS = [0, 1, 2];

/** Mirrors the read-only transaction explorer without management-shaped work. */
export default function Loading() {
  return (
    <RouteSkeleton
      label="Loading transaction activity"
      mainClassName="min-w-0 overflow-x-hidden px-4 py-5 sm:px-8 sm:py-7 lg:px-12"
      containerClassName="mx-auto max-w-7xl"
    >
      <div className="mb-14 grid min-w-0 gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid min-w-0 gap-2.5">
            <SkeletonShape className="h-2.5 w-44 max-w-full rounded-full" />
            <SkeletonShape className="h-8 w-72 max-w-full rounded-lg" />
          </div>
          <div className="flex items-center gap-2">
            <div className="border-line bg-panel flex gap-1 rounded-full border p-1">
              <SkeletonShape className="h-9 w-24 rounded-full" />
              <SkeletonShape className="h-9 w-24 rounded-full" />
            </div>
            <SkeletonShape className="h-11 w-24 rounded-full" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {PERIOD_PILLS.map((pill) => (
            <SkeletonShape key={pill} className="h-9 w-20 rounded-full" />
          ))}
          <div className="flex gap-2 sm:ml-auto">
            <SkeletonShape className="h-9 w-24 rounded-full" />
            <SkeletonShape className="h-9 w-24 rounded-full" />
          </div>
        </div>

        <SkeletonShape className="h-2.5 w-64 max-w-full rounded-full" />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {EXPLORER_FILTERS.map((filter) => (
            <div key={filter} className="grid gap-2">
              <SkeletonShape className="h-2.5 w-20 rounded-full" />
              <SkeletonShape className="h-11 rounded-xl" />
            </div>
          ))}
        </div>

        <div className="border-line flex flex-wrap items-end justify-between gap-4 border-t pt-5">
          <div className="grid min-w-0 gap-2.5">
            <SkeletonShape className="h-2.5 w-32 rounded-full" />
            <SkeletonShape className="h-2.5 w-56 max-w-full rounded-full" />
          </div>
          <SkeletonShape className="hidden h-11 w-36 rounded-full md:block" />
        </div>

        <div className="border-line divide-line grid divide-y overflow-hidden rounded-2xl border">
          {EXPLORER_ROWS.map((row) => (
            <div
              key={row}
              className="bg-surface grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="grid min-w-0 gap-2.5">
                <SkeletonShape className="h-4 w-52 max-w-full rounded" />
                <SkeletonShape className="h-2.5 w-full max-w-sm rounded-full" />
              </div>
              <SkeletonShape className="h-6 w-24 rounded sm:justify-self-end" />
            </div>
          ))}
        </div>
      </div>
    </RouteSkeleton>
  );
}
