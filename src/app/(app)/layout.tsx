import Link from "next/link";
import { LedgerMark } from "@/components/ledger-mark";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireActiveMembership } from "@/lib/auth/dal";
const futureNavigation = ["Budgets"] as const;
export default async function ApplicationLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { membership } = await requireActiveMembership();
  return (
    <div className="bg-surface min-h-screen lg:grid lg:grid-cols-[17.5rem_1fr]">
      <aside className="border-line bg-panel border-b lg:min-h-screen lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between px-5 py-4 lg:px-6 lg:py-6">
          <Link
            href="/dashboard"
            className="focus-visible:outline-brand flex items-center gap-3 rounded-lg focus-visible:outline-2"
          >
            <LedgerMark className="text-brand" />
            <span className="font-display text-ink text-lg font-semibold">
              Budget App
            </span>
          </Link>
          <span className="font-utility text-muted text-[.62rem] uppercase lg:hidden">
            Family ledger
          </span>
        </div>
        <nav aria-label="Application" className="px-3 py-4 lg:pt-8">
          <Link
            href="/dashboard"
            className="text-ink hover:bg-surface flex min-h-11 items-center justify-between rounded-xl px-3.5 text-sm font-semibold"
          >
            Overview
            <span className="font-utility text-brand text-[.62rem]">01</span>
          </Link>
          <Link
            href="/settings/members"
            className="text-ink hover:bg-surface mt-1 flex min-h-11 items-center justify-between rounded-xl px-3.5 text-sm font-semibold"
          >
            Household
            <span className="font-utility text-brand text-[.62rem]">02</span>
          </Link>
          <Link
            href="/accounts"
            className="text-ink hover:bg-surface focus-visible:outline-brand mt-1 flex min-h-11 items-center justify-between rounded-xl px-3.5 text-sm font-semibold focus-visible:outline-2"
          >
            Accounts
            <span className="font-utility text-brand text-[.62rem]">03</span>
          </Link>
          <Link
            href="/transactions"
            className="text-ink hover:bg-surface mt-1 flex min-h-11 items-center justify-between rounded-xl px-3.5 text-sm font-semibold"
          >
            Transactions
            <span className="font-utility text-brand text-[.62rem]">04</span>
          </Link>
          <Link
            href="/categories"
            className="text-ink hover:bg-surface mt-1 flex min-h-11 items-center justify-between rounded-xl px-3.5 text-sm font-semibold"
          >
            Categories
            <span className="font-utility text-brand text-[.62rem]">05</span>
          </Link>
          {futureNavigation.map((label, index) => (
            <span
              key={label}
              aria-disabled
              className="text-muted/65 mt-1 hidden min-h-11 items-center justify-between px-3.5 text-sm lg:flex"
            >
              {label}
              <span className="font-utility text-[.62rem]">0{index + 6}</span>
            </span>
          ))}
        </nav>
        <div className="border-line relative mx-6 mt-8 hidden border-t pt-6 lg:block">
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
      <div className="min-w-0">
        <header className="border-line flex min-h-17 items-center justify-between border-b px-5 sm:px-8">
          <div>
            <p className="font-utility text-muted text-[.62rem] tracking-[.12em] uppercase">
              Private workspace
            </p>
            <p className="text-ink mt-.5 text-sm font-semibold">
              Family ledger
            </p>
          </div>
          <div className="flex items-center gap-1">
            <SignOutButton />
            <Link
              href="/settings/members"
              className="border-line hover:border-brand rounded-lg border px-3 py-2 text-xs font-semibold"
            >
              Manage household
            </Link>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
