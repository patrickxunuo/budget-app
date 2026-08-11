import Link from "next/link";

import { LedgerMark } from "@/components/ledger-mark";

const futureNavigation = ["Accounts", "Categories", "Budgets"] as const;

export default function ApplicationLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="bg-surface min-h-screen lg:grid lg:grid-cols-[17.5rem_1fr]">
      <aside className="border-line bg-panel border-b lg:min-h-screen lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between px-5 py-4 lg:px-6 lg:py-6">
          <Link
            href="/"
            className="focus-visible:outline-brand flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            <LedgerMark className="text-brand" />
            <span className="font-display text-ink text-lg font-semibold tracking-[-0.025em]">
              Budget App
            </span>
          </Link>
          <span className="font-utility text-muted text-[0.62rem] tracking-[0.12em] uppercase lg:hidden">
            Shell / 01
          </span>
        </div>

        <nav aria-label="Application" className="hidden px-3 pt-8 lg:block">
          <Link
            href="/dashboard"
            aria-current="page"
            className="bg-surface text-ink flex min-h-11 items-center justify-between rounded-xl px-3.5 text-sm font-semibold shadow-[inset_3px_0_0_var(--brand)]"
          >
            Overview
            <span className="font-utility text-brand text-[0.62rem]">01</span>
          </Link>
          {futureNavigation.map((label, index) => (
            <span
              key={label}
              aria-disabled="true"
              className="text-muted/65 mt-1 flex min-h-11 items-center justify-between px-3.5 text-sm"
            >
              {label}
              <span className="font-utility text-[0.62rem]">0{index + 2}</span>
            </span>
          ))}
        </nav>

        <div className="border-line relative mx-6 mt-12 hidden border-t pt-6 lg:block">
          <span className="bg-brand absolute top-0 left-0 h-20 w-px" />
          <div className="pl-4">
            <p className="font-utility text-brand text-[0.62rem] tracking-[0.12em] uppercase">
              Read-only rail
            </p>
            <p className="text-muted mt-2 text-xs leading-5">
              Bank data may enter this ledger. Money cannot leave through it.
            </p>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="border-line flex min-h-17 items-center justify-between border-b px-5 sm:px-8">
          <div>
            <p className="font-utility text-muted text-[0.62rem] tracking-[0.12em] uppercase">
              Workspace
            </p>
            <p className="text-ink mt-0.5 text-sm font-semibold">
              First family setup
            </p>
          </div>
          <div
            aria-label="Planned dashboard scopes"
            className="border-line bg-panel flex rounded-lg border p-1 text-xs font-semibold"
          >
            <span className="bg-surface text-ink rounded-md px-3 py-1.5 shadow-sm">
              Family
            </span>
            <span className="text-muted px-3 py-1.5">Personal</span>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
