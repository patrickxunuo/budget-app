import {
  RouteSkeleton,
  SkeletonShape,
} from "@/components/app-shell/route-skeleton";

const FORM_FIELDS = [0, 1, 2, 3];
const REGISTER_ROWS = [0, 1, 2];

/** Mirrors the Manual/Cash heading, entry form, and scoped register. */
export default function Loading() {
  return (
    <RouteSkeleton
      label="Loading Manual and Cash management"
      mainClassName="min-w-0 overflow-x-hidden px-4 py-5 sm:px-8 sm:py-7 lg:px-12"
      containerClassName="mx-auto max-w-7xl"
    >
      <div className="border-line mb-8 grid gap-3 border-b pb-6">
        <SkeletonShape className="h-11 w-44 rounded-full" />
        <SkeletonShape className="h-2.5 w-48 rounded-full" />
        <SkeletonShape className="h-10 w-80 max-w-full rounded-lg" />
        <SkeletonShape className="h-3 w-full max-w-xl rounded-full" />
      </div>

      <div className="mb-16 grid gap-8 xl:grid-cols-[minmax(19rem,24rem)_minmax(0,1fr)] xl:items-start">
        <div className="border-line bg-panel overflow-hidden rounded-[1.75rem] border p-5 shadow-[0_18px_55px_rgba(30,46,39,.07)] sm:p-6">
          <div className="grid gap-2.5">
            <SkeletonShape className="h-2.5 w-36 rounded-full" />
            <SkeletonShape className="h-8 w-52 max-w-full rounded-lg" />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <SkeletonShape className="h-11 rounded-xl" />
            <SkeletonShape className="h-11 rounded-xl" />
          </div>
          <div className="mt-4 grid gap-4">
            {FORM_FIELDS.map((field) => (
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
            <SkeletonShape className="hidden h-10 w-36 rounded-full md:block" />
          </div>
          <div className="border-line divide-line grid divide-y overflow-hidden rounded-2xl border">
            {REGISTER_ROWS.map((entry) => (
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
    </RouteSkeleton>
  );
}
