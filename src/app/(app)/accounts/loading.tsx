import {
  RouteSkeleton,
  SkeletonShape,
} from "@/components/app-shell/route-skeleton";

/* Counts are chosen to establish the page's rhythm, not to predict how many
   institutions a member has linked. */
const SYNC_ITEMS = [0, 1];
const CONNECTION_CARDS = [0, 1];
const CONNECTION_ACCOUNTS = [0, 1];
const DOSSIER_STEPS = [0, 1, 2];

/**
 * Mirrors the connection dossier: masthead, the data-freshness strip, the
 * linked-institution cards, and the two-column link flow that closes the page.
 */
export default function Loading() {
  return (
    <RouteSkeleton
      label="Loading the connection dossier"
      mainClassName="px-5 py-9 sm:px-8 sm:py-11 lg:px-12 lg:py-14"
      containerClassName="mx-auto max-w-6xl"
    >
      <div className="mb-8 grid gap-5 lg:grid-cols-[1fr_22rem] lg:items-end">
        <div>
          <SkeletonShape className="h-3 w-56 max-w-full rounded-full" />
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

      <div className="border-line bg-panel mb-8 overflow-hidden rounded-[1.75rem] border p-5 shadow-[0_16px_50px_rgba(48,38,27,.06)] sm:p-7">
        <div className="border-line flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid gap-2.5">
            <SkeletonShape className="h-2.5 w-28 rounded-full" />
            <SkeletonShape className="h-6 w-44 max-w-full rounded-lg" />
          </div>
          <div className="grid max-w-md gap-2.5 sm:w-64">
            <SkeletonShape className="h-2.5 rounded-full" />
            <SkeletonShape className="h-2.5 w-3/4 rounded-full" />
          </div>
        </div>
        <div className="divide-line divide-y">
          {SYNC_ITEMS.map((item) => (
            <div
              key={item}
              className="grid gap-4 py-5 last:pb-0 md:grid-cols-[1fr_auto] md:items-center"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <SkeletonShape className="h-5 w-40 max-w-full rounded" />
                  <SkeletonShape className="h-6 w-24 rounded-full" />
                </div>
                <SkeletonShape className="mt-2.5 h-2.5 w-48 max-w-full rounded-full" />
              </div>
              <SkeletonShape className="h-11 w-44 max-w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-10 w-full max-w-full overflow-x-hidden">
        <div className="border-line mb-5 flex flex-col gap-4 border-y py-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid gap-2.5">
            <SkeletonShape className="h-2.5 w-44 max-w-full rounded-full" />
            <SkeletonShape className="h-8 w-56 max-w-full rounded-lg" />
          </div>
          <div className="grid max-w-xl gap-2.5 sm:w-80">
            <SkeletonShape className="h-2.5 rounded-full" />
            <SkeletonShape className="h-2.5 w-5/6 rounded-full" />
          </div>
        </div>
        <div className="grid gap-7">
          {CONNECTION_CARDS.map((card) => (
            <div
              key={card}
              className="border-line bg-surface overflow-hidden border shadow-[0_16px_40px_color-mix(in_srgb,var(--ink)_8%,transparent)]"
            >
              <div className="grid lg:grid-cols-[.72fr_1.55fr]">
                <div className="bg-panel border-line border-b p-6 lg:border-r lg:border-b-0 lg:p-8">
                  <SkeletonShape className="h-2.5 w-40 max-w-full rounded-full" />
                  <SkeletonShape className="mt-4 h-9 w-52 max-w-full rounded-lg" />
                  <div className="mt-5 flex items-center gap-2">
                    <SkeletonShape className="size-2.5 shrink-0 rounded-full" />
                    <SkeletonShape className="h-3.5 w-28 rounded-full" />
                  </div>
                  <div className="border-line mt-6 grid gap-3 border-t pt-5">
                    <SkeletonShape className="h-2.5 w-32 rounded-full" />
                    <SkeletonShape className="h-3.5 w-40 max-w-full rounded" />
                    <SkeletonShape className="h-2.5 w-28 rounded-full" />
                    <SkeletonShape className="h-3.5 w-36 max-w-full rounded" />
                  </div>
                </div>
                <div className="min-w-0 p-5 sm:p-7">
                  <div className="border-mineral/40 grid gap-2.5 border-l-4 px-4 py-3">
                    <SkeletonShape className="h-2.5 rounded-full" />
                    <SkeletonShape className="h-2.5 w-4/5 rounded-full" />
                  </div>
                  <div className="mt-5 grid gap-3">
                    {CONNECTION_ACCOUNTS.map((account) => (
                      <div
                        key={account}
                        className="border-line bg-background grid gap-4 border p-4 sm:grid-cols-[1fr_auto] sm:items-start"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <SkeletonShape className="h-6 w-36 max-w-full rounded" />
                            <SkeletonShape className="h-3 w-16 rounded-full" />
                          </div>
                          <SkeletonShape className="mt-2.5 h-2.5 w-48 max-w-full rounded-full" />
                          <SkeletonShape className="mt-3 h-5 w-28 rounded" />
                          <SkeletonShape className="mt-2.5 h-2.5 w-56 max-w-full rounded-full" />
                        </div>
                        <div className="grid gap-2 sm:w-52">
                          <SkeletonShape className="h-2.5 w-20 rounded-full" />
                          <SkeletonShape className="h-10 rounded-sm" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-line mt-12 border-t pt-8">
        <SkeletonShape className="mb-4 h-2.5 w-56 max-w-full rounded-full" />
        <div className="border-line bg-panel/75 grid overflow-hidden rounded-[1.75rem] border shadow-[0_24px_80px_color-mix(in_srgb,var(--ink)_8%,transparent)] lg:grid-cols-[13rem_1fr]">
          <div className="bg-brand-strong relative overflow-hidden px-6 py-7 lg:min-h-[26rem] lg:px-7">
            {/* The inset rule is part of the real panel's furniture, so it is
                drawn rather than left as another placeholder. */}
            <div
              aria-hidden="true"
              className="border-surface/15 absolute inset-3 rounded-[1.15rem] border"
            />
            <SkeletonShape className="relative h-2.5 w-32 rounded-full opacity-40" />
            <div className="relative mt-9 grid grid-cols-3 gap-2 lg:grid-cols-1 lg:gap-0">
              {DOSSIER_STEPS.map((step) => (
                <div key={step} className="flex min-w-0 gap-3 pb-7 last:pb-0">
                  <SkeletonShape className="size-8 shrink-0 rounded-full opacity-40" />
                  <SkeletonShape className="mt-2 h-3 min-w-0 flex-1 rounded-full opacity-40" />
                </div>
              ))}
            </div>
          </div>
          <div className="bg-surface min-w-0 px-5 py-7 sm:px-8 sm:py-9 lg:px-10">
            <div className="border-line flex flex-col gap-5 border-b pb-7 sm:flex-row sm:items-end sm:justify-between">
              <div className="grid gap-3">
                <SkeletonShape className="h-2.5 w-28 rounded-full" />
                <SkeletonShape className="h-8 w-56 max-w-full rounded-lg sm:h-10" />
                <SkeletonShape className="h-8 w-40 max-w-full rounded-lg sm:h-10" />
              </div>
              <SkeletonShape className="h-12 w-56 max-w-full rounded-full" />
            </div>
            <div className="border-line bg-panel mt-5 flex min-h-14 items-start gap-3 rounded-xl border px-4 py-3">
              <SkeletonShape className="mt-2 size-2 shrink-0 rounded-full" />
              <SkeletonShape className="mt-1.5 h-2.5 w-64 max-w-full rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </RouteSkeleton>
  );
}
