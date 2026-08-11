import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard foundation",
};

const setupPath = [
  ["02", "Protect the family data model", "Supabase schema and RLS"],
  ["03", "Invite the household", "Authentication and membership"],
  ["04", "Connect a bank", "Read-only Plaid Link"],
] as const;

export default function DashboardPage() {
  return (
    <main className="px-5 py-10 sm:px-8 sm:py-12 lg:px-12 lg:py-14">
      <div className="mx-auto max-w-6xl">
        <div className="border-line flex flex-col gap-6 border-b pb-9 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-utility text-brand text-[0.68rem] font-semibold tracking-[0.14em] uppercase">
              Application foundation
            </p>
            <h1 className="font-display text-ink mt-3 max-w-3xl text-5xl leading-[0.95] font-semibold tracking-[-0.055em] sm:text-6xl">
              The ledger is ready for its rules.
            </h1>
          </div>
          <div className="border-line bg-panel text-muted max-w-sm rounded-xl border px-4 py-3 text-sm leading-6">
            Authentication is intentionally not simulated here. The route guard
            arrives with issue #3.
          </div>
        </div>

        <section aria-labelledby="setup-heading" className="mt-10">
          <div className="flex items-center justify-between gap-4">
            <h2
              id="setup-heading"
              className="font-display text-ink text-2xl font-semibold tracking-[-0.035em]"
            >
              Build sequence
            </h2>
            <span className="font-utility text-muted text-[0.65rem] tracking-[0.12em] uppercase">
              3 controls before data
            </span>
          </div>

          <div className="border-line bg-line mt-5 grid gap-px overflow-hidden rounded-2xl border lg:grid-cols-3">
            {setupPath.map(([number, title, detail]) => (
              <article key={number} className="bg-surface p-6">
                <p className="font-utility text-brand text-xs font-semibold">
                  {number}
                </p>
                <h3 className="font-display text-ink mt-12 text-2xl font-semibold tracking-[-0.035em]">
                  {title}
                </h3>
                <p className="text-muted mt-2 text-sm leading-6">{detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
          <div className="border-line bg-panel rounded-2xl border p-5">
            <p className="font-utility text-muted text-[0.65rem] tracking-[0.12em] uppercase">
              Runtime boundary
            </p>
            <p className="text-ink mt-2 max-w-2xl text-sm leading-6">
              Supabase browser access uses publishable credentials. Plaid and
              privileged database clients are isolated in server-only modules.
            </p>
          </div>
          <a
            href="https://github.com/patrickxunuo/budget-app/issues/1"
            className="border-line text-ink hover:border-brand hover:text-brand focus-visible:outline-brand inline-flex min-h-12 items-center justify-center rounded-xl border px-5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            Open foundation issue
          </a>
        </section>
      </div>
    </main>
  );
}
