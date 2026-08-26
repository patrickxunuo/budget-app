import {
  RouteSkeleton,
  SkeletonShape,
} from "@/components/app-shell/route-skeleton";

const LEDGER_ROWS = [0, 1, 2, 3];

/** Mirrors the Plaid management heading and editable transaction register. */
export default function Loading() {
  return (
    <RouteSkeleton
      label="Loading Plaid transaction management"
      mainClassName="min-w-0 overflow-x-hidden px-4 py-5 sm:px-8 sm:py-7 lg:px-12"
      containerClassName="mx-auto max-w-7xl"
    >
      <div className="border-line mb-8 grid gap-3 border-b pb-6">
        <SkeletonShape className="h-11 w-44 rounded-full" />
        <SkeletonShape className="h-2.5 w-48 rounded-full" />
        <SkeletonShape className="h-10 w-64 max-w-full rounded-lg" />
        <SkeletonShape className="h-3 w-full max-w-2xl rounded-full" />
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
    </RouteSkeleton>
  );
}
