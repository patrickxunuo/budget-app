import Link from "next/link";
import {
  BottomNavigation,
  NavigationRail,
} from "@/components/app-shell/primary-navigation";
import { RouteHeader } from "@/components/app-shell/route-header";
import { LedgerMark } from "@/components/ledger-mark";
import { requireActiveMembership } from "@/lib/auth/dal";

export default async function ApplicationLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { membership } = await requireActiveMembership();
  return (
    <div className="bg-surface min-h-screen lg:grid lg:grid-cols-[17.5rem_1fr]">
      <aside className="safe-top safe-x border-line bg-panel hidden border-b lg:sticky lg:top-0 lg:block lg:h-screen lg:self-start lg:overflow-y-auto lg:border-r lg:border-b-0">
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
      <div className="min-w-0 pb-[calc(4.5rem_+_env(safe-area-inset-bottom,0px))] lg:pb-0">
        <RouteHeader />
        {children}
      </div>
      <BottomNavigation />
    </div>
  );
}
