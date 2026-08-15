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
      mainClassName="min-w-0 overflow-x-hidden px-4 py-6 sm:px-8 sm:py-8 lg:px-12"
      containerClassName="mx-auto max-w-7xl"
    >
      <div
        data-testid="dashboard-skeleton-heading-scope"
        className="border-line grid gap-5 border-b pb-5 sm:grid-cols-[1fr_auto] sm:items-end"
      >
        <div>
          <SkeletonShape className="h-2.5 w-52 max-w-full rounded-full" />
          <SkeletonShape className="mt-3 h-8 w-80 max-w-full rounded-lg" />
          <SkeletonShape className="mt-3 h-3 w-full max-w-xl rounded-full" />
        </div>
        <div className="border-line bg-panel grid w-fit grid-cols-2 gap-1 rounded-full border p-1">
          <SkeletonShape className="h-11 w-24 rounded-full" />
          <SkeletonShape className="h-11 w-24 rounded-full" />
        </div>
      </div>

      <div className="min-h-6 py-1" />

      <div
        data-testid="dashboard-skeleton-budget"
        className="border-line bg-surface overflow-hidden rounded-2xl border"
      >
        <div className="grid lg:grid-cols-[1.3fr_.7fr]">
          <div className="p-5 sm:p-7 lg:p-9">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <SkeletonShape className="h-2.5 w-40 max-w-full rounded-full" />
                <SkeletonShape className="mt-3 h-6 w-64 max-w-full rounded" />
              </div>
              <SkeletonShape className="h-9 w-36 rounded-full" />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-3">
              <SkeletonShape className="col-span-2 h-12 rounded-lg sm:col-span-1" />
              <SkeletonShape className="h-9 rounded-lg" />
              <SkeletonShape className="h-9 rounded-lg" />
            </div>
            <SkeletonShape className="mt-6 h-2 w-full rounded-full" />
          </div>
          <div className="border-line bg-panel border-t p-5 sm:p-7 lg:border-t-0 lg:border-l lg:p-9">
            <SkeletonShape className="h-2.5 w-32 rounded-full" />
            <SkeletonShape className="mt-4 h-9 w-44 rounded-lg" />
            <SkeletonShape className="mt-3 h-3 w-full rounded-full" />
          </div>
        </div>
      </div>

      <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[1.55fr_.75fr]">
        <div
          data-testid="dashboard-skeleton-comparison"
          className="border-line bg-surface min-w-0 rounded-2xl border p-5 sm:p-7"
        >
          <SkeletonShape className="h-2.5 w-44 rounded-full" />
          <SkeletonShape className="mt-3 h-7 w-72 max-w-full rounded-lg" />
          <SkeletonShape className="mt-3 h-3 w-52 max-w-full rounded-full" />
          <div className="mt-7 flex h-36 items-end gap-3">
            {CHART_POINTS.map((point) => (
              <SkeletonShape
                key={point}
                className={`flex-1 rounded-t ${
                  point % 3 === 0 ? "h-12" : point % 3 === 1 ? "h-20" : "h-28"
                }`}
              />
            ))}
          </div>
          <div className="border-line mt-5 grid grid-cols-3 gap-4 border-t pt-4">
            <SkeletonShape className="h-3 rounded-full" />
            <SkeletonShape className="h-3 rounded-full" />
            <SkeletonShape className="h-3 rounded-full" />
          </div>
        </div>

        <div
          data-testid="dashboard-skeleton-accounts"
          className="border-line bg-panel min-w-0 rounded-2xl border p-5 sm:p-7"
        >
          <SkeletonShape className="h-2.5 w-28 rounded-full" />
          <SkeletonShape className="mt-3 h-7 w-48 max-w-full rounded-lg" />
          {ACCOUNT_ROWS.map((row) => (
            <div key={row} className="border-line mt-4 border-t pt-4">
              <SkeletonShape className="h-4 w-40 max-w-full rounded" />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <SkeletonShape className="h-8 rounded-lg" />
                <SkeletonShape className="h-8 rounded-lg" />
              </div>
              <SkeletonShape className="mt-3 h-2.5 w-36 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </RouteSkeleton>
  );
}
