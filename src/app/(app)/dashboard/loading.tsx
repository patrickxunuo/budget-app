import {
  RouteSkeleton,
  SkeletonShape,
} from "@/components/app-shell/route-skeleton";

const CHART_POINTS = [0, 1, 2, 3, 4, 5, 6];
const ACCOUNT_ROWS = [0, 1, 2];

export default function Loading() {
  return (
    <RouteSkeleton
      label="Loading the month-to-date overview"
      mainClassName="min-w-0 overflow-x-hidden px-4 py-4 sm:px-8 sm:py-6 lg:px-12"
      containerClassName="mx-auto max-w-7xl"
    >
      <div
        data-testid="dashboard-skeleton-heading-scope"
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <SkeletonShape className="h-6 w-36 rounded-lg" />
        <div className="border-line bg-panel grid grid-cols-2 gap-1 rounded-full border p-1">
          <SkeletonShape className="h-11 w-20 rounded-full" />
          <SkeletonShape className="h-11 w-20 rounded-full" />
        </div>
      </div>

      <div className="min-h-5 py-0.5" />

      <div
        data-testid="dashboard-skeleton-budget"
        className="border-line bg-surface overflow-hidden rounded-2xl border"
      >
        <div className="p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <SkeletonShape className="h-7 w-24 rounded-lg" />
            <SkeletonShape className="h-9 w-36 rounded-full" />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 sm:gap-6">
            <SkeletonShape className="h-12 rounded-lg" />
            <SkeletonShape className="h-10 rounded-lg" />
            <SkeletonShape className="h-10 rounded-lg" />
          </div>
          <SkeletonShape className="mt-4 h-2 w-full rounded-full" />
          <div className="mt-2 flex justify-between gap-4">
            <SkeletonShape className="h-2.5 w-28 rounded-full" />
            <SkeletonShape className="h-2.5 w-32 rounded-full" />
          </div>
        </div>
        <div className="border-line bg-panel flex items-center justify-between gap-3 border-t px-4 py-3 sm:px-6">
          <SkeletonShape className="h-6 w-28 rounded-lg" />
          <SkeletonShape className="h-2.5 w-24 rounded-full" />
        </div>
      </div>

      <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[1.55fr_.75fr] lg:gap-6">
        <div
          data-testid="dashboard-skeleton-accounts"
          className="border-line bg-panel min-w-0 rounded-2xl border p-4 sm:p-6 lg:order-2"
        >
          <SkeletonShape className="h-7 w-28 rounded-lg" />
          {ACCOUNT_ROWS.map((row) => (
            <div
              key={row}
              className="border-line mt-3 border-t pt-3 first:border-t-0"
            >
              <SkeletonShape className="h-4 w-40 max-w-full rounded" />
              <div className="mt-3 grid grid-cols-2 gap-3">
                <SkeletonShape className="h-8 rounded-lg" />
                <SkeletonShape className="h-8 rounded-lg" />
              </div>
              <SkeletonShape className="mt-2 h-2.5 w-36 rounded-full" />
            </div>
          ))}
        </div>

        <div
          data-testid="dashboard-skeleton-comparison"
          className="border-line bg-surface min-w-0 rounded-2xl border p-4 sm:p-6 lg:order-1"
        >
          <div className="flex items-end justify-between gap-3">
            <SkeletonShape className="h-7 w-40 rounded-lg" />
            <SkeletonShape className="h-3 w-36 rounded-full" />
          </div>
          <SkeletonShape className="mt-2 h-3 w-52 max-w-full rounded-full" />
          <div className="mt-4 flex h-36 items-end gap-3">
            {CHART_POINTS.map((point) => (
              <SkeletonShape
                key={point}
                className={`flex-1 rounded-t ${
                  point % 3 === 0 ? "h-12" : point % 3 === 1 ? "h-20" : "h-28"
                }`}
              />
            ))}
          </div>
          <SkeletonShape className="border-line mt-4 h-11 w-full rounded-lg border-t lg:h-24" />
        </div>
      </div>
    </RouteSkeleton>
  );
}
