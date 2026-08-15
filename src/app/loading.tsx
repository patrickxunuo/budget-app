import { SkeletonShape } from "@/components/app-shell/route-skeleton";
import { SkeletonAnnouncement } from "@/components/app-shell/skeleton-announcement";

/**
 * The cold-boot fallback. It sits above `(app)/layout.tsx`, so there is no
 * rail, no bottom bar, and no pinned header for it to slot into: it is a
 * full-viewport screen in the same language as `/offline`, not a route
 * skeleton. The test id differs from `route-skeleton` for exactly that reason
 * — coverage has to be able to prove which of the two it is looking at.
 */
export default function Loading() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      aria-busy="true"
      data-testid="root-loading"
      className="grid min-h-screen place-items-center px-5"
    >
      <SkeletonAnnouncement message="Opening the ledger" />
      <div className="border-line bg-surface w-full max-w-lg rounded-2xl border p-7">
        <SkeletonShape className="h-3 w-40 rounded-full" />
        <div className="mt-5 grid gap-3">
          <SkeletonShape className="h-8 w-full rounded-lg" />
          <SkeletonShape className="h-8 w-3/5 rounded-lg" />
        </div>
        <div className="mt-6 grid gap-2.5">
          <SkeletonShape className="h-2.5 w-full rounded-full" />
          <SkeletonShape className="h-2.5 w-11/12 rounded-full" />
          <SkeletonShape className="h-2.5 w-3/4 rounded-full" />
        </div>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <SkeletonShape className="h-11 w-36 rounded-xl" />
          <SkeletonShape className="h-11 w-40 rounded-xl" />
        </div>
      </div>
    </main>
  );
}
