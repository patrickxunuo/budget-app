import type { Metadata } from "next";
import Link from "next/link";

import { LedgerMark } from "@/components/ledger-mark";
import { InstallGuidance } from "@/components/pwa/install-guidance";

export const metadata: Metadata = {
  title: "Install",
  description:
    "Install Budget App on a phone, tablet, or desktop. Every figure still comes from the network.",
};

/** Public: a member may need these instructions before they can sign in. */
export default function InstallPage() {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen px-5 py-5 sm:px-8 sm:py-8 lg:px-12">
      <div className="border-line bg-surface mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-[64rem] flex-col overflow-hidden rounded-[1.5rem] border shadow-[0_24px_80px_rgba(18,44,33,0.12)] sm:min-h-[calc(100vh-4rem)]">
        <header className="border-line flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-8">
          <Link
            href="/"
            className="group focus-visible:outline-focus flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            <LedgerMark className="text-brand" />
            <span className="font-display text-ink text-lg font-semibold tracking-[-0.025em]">
              Budget App
            </span>
          </Link>
          <div className="font-utility text-muted flex items-center gap-2 text-[0.68rem] font-medium tracking-[0.12em] uppercase">
            <span className="bg-brand size-1.5 rounded-full" />
            Install / home screen
          </div>
        </header>

        <div className="flex flex-1 flex-col px-5 py-10 sm:px-8 sm:py-14 lg:px-14">
          <p className="font-utility text-brand mb-6 flex items-center gap-3 text-[0.7rem] font-semibold tracking-[0.16em] uppercase">
            <span className="bg-brand h-px w-8" />
            Installed, but never offline data
          </p>
          <h1 className="font-display text-ink max-w-3xl text-[clamp(2.5rem,6vw,4.5rem)] leading-[0.92] font-semibold tracking-[-0.06em]">
            Put the ledger on your home screen.
          </h1>
          <p className="text-muted mt-6 max-w-2xl text-base leading-7">
            Budget App installs like an app: its own icon, its own window, no
            browser chrome. What it does not do is keep your money on the
            device. Transactions, balances, and budgets are always fetched over
            the network and none of them are stored locally, so an installed
            copy that loses its connection says so plainly instead of showing
            figures that may no longer be true.
          </p>

          <div className="mt-10">
            <InstallGuidance />
          </div>

          <div className="border-line-soft mt-10 flex flex-wrap items-center gap-3 border-t pt-6">
            <Link
              href="/dashboard"
              className="bg-brand text-on-accent hover:bg-brand-strong focus-visible:outline-focus inline-flex min-h-11 items-center rounded-xl px-5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4"
            >
              Open the ledger
            </Link>
            <Link
              href="/"
              className="border-line text-ink hover:border-brand hover:text-brand focus-visible:outline-focus inline-flex min-h-11 items-center rounded-xl border px-5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4"
            >
              Back to the landing page
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
