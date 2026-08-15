import {
  RouteSkeleton,
  SkeletonShape,
} from "@/components/app-shell/route-skeleton";

/* Counts are chosen to establish the page's rhythm, not to predict how many
   labels a household keeps. */
const SCOPE_REGISTERS = [0, 1];
const CATEGORY_ROWS = [0, 1, 2];
const RULE_ROWS = [0, 1, 2];

/**
 * Mirrors the classification index: masthead, the create strip above the two
 * scoped category registers, and the merchant-rule aside beside them.
 */
export default function Loading() {
  return (
    <RouteSkeleton
      label="Loading the category index"
      mainClassName="px-5 py-9 sm:px-8 lg:px-12 lg:py-14"
      containerClassName="mx-auto max-w-6xl"
    >
      <div className="mb-9 grid gap-5 lg:grid-cols-[1fr_22rem] lg:items-end">
        <div>
          <SkeletonShape className="h-3 w-60 max-w-full rounded-full" />
          <div className="mt-4 grid max-w-3xl gap-3">
            <SkeletonShape className="h-10 rounded-lg sm:h-12" />
            <SkeletonShape className="h-10 w-3/5 rounded-lg sm:h-12" />
          </div>
        </div>
        <div className="border-line grid gap-2.5 border-l pl-5">
          <SkeletonShape className="h-2.5 rounded-full" />
          <SkeletonShape className="h-2.5 rounded-full" />
          <SkeletonShape className="h-2.5 w-4/5 rounded-full" />
        </div>
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0 space-y-7">
          <div className="border-line bg-panel grid gap-4 rounded-[1.5rem] border p-5 sm:grid-cols-[1fr_8rem_9rem_auto] sm:items-end">
            <div className="grid gap-2">
              <SkeletonShape className="h-2.5 w-28 rounded-full" />
              <SkeletonShape className="h-11 rounded-lg" />
            </div>
            <div className="grid gap-2">
              <SkeletonShape className="h-2.5 w-10 rounded-full" />
              <SkeletonShape className="h-11 rounded-lg" />
            </div>
            <div className="grid gap-2">
              <SkeletonShape className="h-2.5 w-16 rounded-full" />
              <SkeletonShape className="h-11 rounded-lg" />
            </div>
            <SkeletonShape className="h-11 w-full rounded-full sm:w-32" />
          </div>

          {SCOPE_REGISTERS.map((register) => (
            <div key={register}>
              <div className="mb-3 flex items-baseline justify-between gap-4">
                <SkeletonShape className="h-7 w-48 max-w-full rounded-lg" />
                <SkeletonShape className="h-2.5 w-32 shrink-0 rounded-full" />
              </div>
              <div className="border-line divide-line divide-y overflow-hidden rounded-2xl border">
                {CATEGORY_ROWS.map((row) => (
                  <div
                    key={row}
                    className="bg-surface flex items-center gap-4 p-4"
                  >
                    <SkeletonShape className="size-3 shrink-0 rounded-full" />
                    <div className="grid min-w-0 flex-1 gap-2">
                      <SkeletonShape className="h-4 w-40 max-w-full rounded" />
                      <SkeletonShape className="h-2.5 w-56 max-w-full rounded-full" />
                    </div>
                    <SkeletonShape className="h-9 w-20 shrink-0 rounded" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="min-w-0">
          <SkeletonShape className="h-2.5 w-32 rounded-full" />
          <SkeletonShape className="mt-3 h-8 w-52 max-w-full rounded-lg" />
          <div className="mt-3 grid gap-2.5">
            <SkeletonShape className="h-2.5 rounded-full" />
            <SkeletonShape className="h-2.5 w-4/5 rounded-full" />
          </div>
          <div className="border-line divide-line mt-5 divide-y rounded-2xl border">
            {RULE_ROWS.map((rule) => (
              <div key={rule} className="grid gap-2 p-4">
                <SkeletonShape className="h-4 w-36 max-w-full rounded" />
                <SkeletonShape className="h-2.5 w-28 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </RouteSkeleton>
  );
}
