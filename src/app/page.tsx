import Link from "next/link";

import { LedgerMark } from "@/components/ledger-mark";

const contract = [
  ["Bank access", "Read-only"],
  ["Region", "Canada / CAD"],
  ["Household", "Invite-only"],
  ["Data path", "Plaid → private database"],
] as const;

export default function Home() {
  return (
    <main className="min-h-screen px-5 py-5 sm:px-8 sm:py-8 lg:px-12">
      <div className="border-line bg-surface mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-[88rem] flex-col overflow-hidden rounded-[1.5rem] border shadow-[0_24px_80px_rgba(18,44,33,0.12)] sm:min-h-[calc(100vh-4rem)]">
        <header className="border-line flex items-center justify-between border-b px-5 py-4 sm:px-8">
          <Link
            href="/"
            className="group focus-visible:outline-brand flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            <LedgerMark className="text-brand transition-transform group-hover:-rotate-3" />
            <span className="font-display text-ink text-lg font-semibold tracking-[-0.025em]">
              Budget App
            </span>
          </Link>
          <div className="font-utility text-muted flex items-center gap-2 text-[0.68rem] font-medium tracking-[0.12em] uppercase">
            <span className="bg-brand size-1.5 rounded-full" />
            Foundation / 01
          </div>
        </header>

        <div className="grid flex-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(23rem,0.85fr)]">
          <section className="flex flex-col justify-between px-5 py-12 sm:px-8 sm:py-16 lg:px-14 lg:py-20">
            <div>
              <p className="font-utility text-brand mb-7 flex items-center gap-3 text-[0.7rem] font-semibold tracking-[0.16em] uppercase">
                <span className="bg-brand h-px w-8" />A private ledger for the
                people at home
              </p>
              <h1 className="font-display text-ink max-w-4xl text-[clamp(3.25rem,8vw,7.7rem)] leading-[0.88] font-semibold tracking-[-0.07em]">
                Shared money.
                <span className="text-mineral block">Clear boundaries.</span>
              </h1>
              <p className="text-muted mt-8 max-w-xl text-base leading-7 sm:text-lg sm:leading-8">
                Keep family accounts visible to the household and personal
                accounts private to their owner. Bank connections can provide
                context, never move money.
              </p>
            </div>

            <div className="mt-12 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/dashboard"
                className="bg-brand hover:bg-brand-strong focus-visible:outline-brand inline-flex min-h-12 items-center justify-center rounded-xl px-5 text-sm font-semibold text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-4"
              >
                View application shell
              </Link>
              <a
                href="https://github.com/patrickxunuo/budget-app/issues/1"
                className="border-line text-ink hover:border-brand hover:text-brand focus-visible:outline-brand inline-flex min-h-12 items-center justify-center rounded-xl border px-5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4"
              >
                Follow issue #1
              </a>
            </div>
          </section>

          <aside className="border-line bg-panel relative border-t px-5 py-10 sm:px-8 lg:border-t-0 lg:border-l lg:px-10 lg:py-12">
            <div className="bg-brand/30 absolute top-0 bottom-0 left-8 hidden w-px sm:block lg:left-10" />
            <div className="relative sm:pl-7">
              <div className="mb-12 flex items-start justify-between gap-4">
                <div>
                  <p className="font-utility text-muted text-[0.68rem] font-semibold tracking-[0.14em] uppercase">
                    Connection contract
                  </p>
                  <h2 className="font-display text-ink mt-2 text-3xl font-semibold tracking-[-0.045em]">
                    Read access has limits.
                  </h2>
                </div>
                <span className="border-brand/30 bg-brand/8 font-utility text-brand mt-1 rounded-full border px-3 py-1 text-[0.65rem] font-semibold tracking-[0.1em] uppercase">
                  Enforced
                </span>
              </div>

              <dl className="divide-line border-line divide-y border-y">
                {contract.map(([label, value]) => (
                  <div
                    key={label}
                    className="grid grid-cols-[7rem_1fr] gap-4 py-4"
                  >
                    <dt className="font-utility text-muted text-[0.68rem] tracking-[0.08em] uppercase">
                      {label}
                    </dt>
                    <dd className="text-ink text-sm font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>

              <div className="bg-ink text-panel mt-12 rounded-2xl p-5 shadow-[0_18px_36px_rgba(17,34,27,0.18)]">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="font-utility text-panel/60 text-[0.65rem] tracking-[0.13em] uppercase">
                      Transfers available
                    </p>
                    <p className="font-display mt-2 text-6xl leading-none font-semibold tracking-[-0.08em]">
                      0
                    </p>
                  </div>
                  <p className="text-panel/65 max-w-32 text-right text-xs leading-5">
                    By product design, not by user permission.
                  </p>
                </div>
              </div>
            </div>
          </aside>
        </div>

        <footer className="border-line font-utility text-muted flex flex-col gap-2 border-t px-5 py-4 text-[0.65rem] tracking-[0.08em] uppercase sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>Self-hosted · MIT licensed</span>
          <span>Vercel / Supabase / Plaid Transactions</span>
        </footer>
      </div>
    </main>
  );
}
