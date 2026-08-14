import Link from "next/link";
import {
  BottomNavigation,
  NavigationRail,
} from "@/components/app-shell/primary-navigation";
import { LedgerMark } from "@/components/ledger-mark";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { requireActiveMembership } from "@/lib/auth/dal";

export default async function ApplicationLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { membership } = await requireActiveMembership();
  return (
    <div className="bg-surface min-h-screen lg:grid lg:grid-cols-[17.5rem_1fr]">
      {/* Sticky within its grid area so the rail stays put while the page
          scrolls, with its own overflow for when the nav outgrows the
          viewport. Below `lg` this is the top bar and navigation moves to the
          fixed bottom bar. The safe-area helpers sit on this element rather
          than on the padded child because they are unlayered CSS and would
          otherwise overwrite a Tailwind padding utility on the same box. */}
      <aside className="safe-top safe-x border-line bg-panel border-b lg:sticky lg:top-0 lg:h-screen lg:self-start lg:overflow-y-auto lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-3 px-5 py-4 lg:px-6 lg:py-6">
          <Link
            href="/dashboard"
            className="focus-visible:outline-focus flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline-2"
          >
            <LedgerMark className="text-brand" />
            <span className="font-display text-ink truncate text-lg font-semibold">
              Budget App
            </span>
          </Link>
          <span className="font-utility text-muted shrink-0 text-[.62rem] uppercase lg:hidden">
            Family ledger
          </span>
        </div>
        <NavigationRail />
        <div className="border-line relative mx-6 mt-8 hidden border-t pt-6 pb-8 lg:block">
          <span className="bg-brand absolute top-0 left-0 h-20 w-px" />
          <p className="font-utility text-brand pl-4 text-[.62rem] tracking-[.12em] uppercase">
            {membership.role} access
          </p>
          <p className="text-muted mt-2 pl-4 text-xs leading-5">
            Personal records remain private even inside the shared family
            workspace.
          </p>
        </div>
      </aside>
      {/* Reserves the fixed bottom bar's height plus the home-indicator inset
          below `lg`, so the last row of a page is never trapped under it. */}
      <div className="min-w-0 pb-[calc(4.5rem_+_env(safe-area-inset-bottom,0px))] lg:pb-0">
        {/* Pinned (1211e33): the header needs an opaque background of its own,
            because without one the page scrolls visibly through it. z-20 keeps
            it above the in-page sticky elements, which use z-10. The safe-area
            padding sits here rather than on the <header> so it cannot collide
            with that element's own px/py utilities. */}
        <div className="safe-x border-line bg-surface sticky top-0 z-20 border-b">
          <header className="flex min-h-17 flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-3 sm:px-8">
            <div className="min-w-0">
              <p className="font-utility text-muted text-[.62rem] tracking-[.12em] uppercase">
                Private workspace
              </p>
              <p className="text-ink mt-.5 text-sm font-semibold">
                Family ledger
              </p>
            </div>
            {/* Appearance and installation are rendered exactly once and stay
                visible at every breakpoint: a second copy would duplicate the
                radio group's element ids and its accessible names. The row
                wraps below `sm` so nothing overflows at 390px. */}
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              <ThemeToggle />
              <Link
                href="/install"
                className="border-line text-ink hover:border-brand hover:text-brand focus-visible:outline-focus flex min-h-11 shrink-0 items-center rounded-xl border px-3.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Install app
              </Link>
              <Link
                href="/settings/members"
                className="border-line hover:border-brand focus-visible:outline-focus flex min-h-11 shrink-0 items-center rounded-lg border px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Manage household
              </Link>
              <SignOutButton />
            </div>
          </header>
        </div>
        {children}
      </div>
      <BottomNavigation />
    </div>
  );
}
