import {
  RouteSkeleton,
  SkeletonShape,
} from "@/components/app-shell/route-skeleton";

/* Counts are chosen to establish the page's rhythm, not to predict how large
   a household is. */
const ROSTER_ROWS = [0, 1, 2];
const INVITATION_ROWS = [0, 1];

/**
 * Mirrors the membership register: masthead, the roster with its per-member
 * actions, the invitation block, and the guarded-action band beneath them.
 */
export default function Loading() {
  return (
    <RouteSkeleton
      label="Loading the household roster"
      mainClassName="px-5 py-10 sm:px-8 lg:px-12"
      containerClassName="mx-auto max-w-5xl"
    >
      <div className="border-line mb-10 border-b pb-8">
        <SkeletonShape className="h-3 w-64 max-w-full rounded-full" />
        <div className="mt-4 grid max-w-2xl gap-3">
          <SkeletonShape className="h-10 rounded-lg sm:h-12" />
          <SkeletonShape className="h-10 w-2/5 rounded-lg sm:h-12" />
        </div>
        <div className="mt-5 grid max-w-2xl gap-2.5">
          <SkeletonShape className="h-2.5 rounded-full" />
          <SkeletonShape className="h-2.5 w-3/4 rounded-full" />
        </div>
      </div>

      <div className="space-y-10">
        <div>
          <div className="flex items-end justify-between gap-4">
            <div className="grid min-w-0 gap-2.5">
              <SkeletonShape className="h-2.5 w-36 max-w-full rounded-full" />
              <SkeletonShape className="h-8 w-56 max-w-full rounded-lg" />
            </div>
            <SkeletonShape className="h-3 w-8 shrink-0 rounded-full" />
          </div>
          <div className="border-line divide-line mt-5 divide-y rounded-2xl border">
            {ROSTER_ROWS.map((row) => (
              <div
                key={row}
                className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="grid min-w-0 gap-2.5">
                  <SkeletonShape className="h-4 w-40 max-w-full rounded" />
                  <SkeletonShape className="h-2.5 w-20 rounded-full" />
                </div>
                <div className="flex flex-wrap gap-3">
                  <SkeletonShape className="h-9 w-36 rounded-lg" />
                  <SkeletonShape className="h-9 w-32 rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-line bg-panel rounded-2xl border p-5 sm:p-6">
          <SkeletonShape className="h-7 w-56 max-w-full rounded-lg" />
          <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
            <div className="grid gap-2">
              <SkeletonShape className="h-2.5 w-16 rounded-full" />
              <SkeletonShape className="h-12 rounded-xl" />
            </div>
            <div className="grid gap-2">
              <SkeletonShape className="h-2.5 w-20 rounded-full" />
              <SkeletonShape className="h-12 rounded-xl" />
            </div>
            <SkeletonShape className="h-12 w-full rounded-xl sm:w-32" />
          </div>
          <div className="mt-6 space-y-2">
            {INVITATION_ROWS.map((row) => (
              <div
                key={row}
                className="bg-surface flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="grid min-w-0 gap-2.5">
                  <SkeletonShape className="h-3.5 w-48 max-w-full rounded" />
                  <SkeletonShape className="h-2.5 w-36 max-w-full rounded-full" />
                </div>
                <SkeletonShape className="h-9 w-28 shrink-0 rounded-lg" />
              </div>
            ))}
          </div>
        </div>

        <div className="border-mineral/30 bg-mineral/5 rounded-2xl border p-5 sm:p-6">
          <SkeletonShape className="h-7 w-72 max-w-full rounded-lg" />
          <div className="mt-2.5 grid max-w-xl gap-2.5">
            <SkeletonShape className="h-2.5 rounded-full" />
            <SkeletonShape className="h-2.5 w-2/3 rounded-full" />
          </div>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="grid flex-1 gap-2">
              <SkeletonShape className="h-2.5 w-32 rounded-full" />
              <SkeletonShape className="h-12 rounded-xl" />
            </div>
            <SkeletonShape className="h-12 w-full rounded-xl sm:w-44" />
          </div>
        </div>
      </div>
    </RouteSkeleton>
  );
}
