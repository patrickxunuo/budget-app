import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline",
  description:
    "Budget App is offline. Financial data is deliberately never stored on the device.",
};

/**
 * The one document the service worker precaches and serves when a navigation
 * fails. It is a plain, static Server Component with no session lookup and no
 * data access: nothing here may depend on the network, and nothing here may
 * carry a member's money.
 *
 * Both actions are ordinary anchors rather than client-side links, so they work
 * before any JavaScript has hydrated and go straight back to the network.
 */
export default function OfflinePage() {
  return (
    <main id="main-content" tabIndex={-1} className="grid min-h-screen place-items-center px-5">
      <div className="border-line bg-surface w-full max-w-lg rounded-2xl border p-7">
        <p className="font-utility text-muted flex items-center gap-2 text-[0.68rem] tracking-[0.14em] uppercase">
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            focusable="false"
            className="text-alert size-4 shrink-0"
          >
            <path
              d="M10 2.2 18.6 17.4H1.4z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path
              d="M10 7.4v4M10 14.1v.9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          Offline / no connection
        </p>
        <h1 className="font-display text-ink mt-3 text-4xl font-semibold tracking-[-0.05em]">
          This device is offline.
        </h1>
        <p className="text-muted mt-4 text-sm leading-6">
          Budget App never stores your transactions, balances, or budgets on the
          device. That is deliberate: a phone left on a table cannot reveal a
          household ledger. It also means those figures need a live connection,
          so nothing is shown here rather than something stale.
        </p>
        <p className="text-muted mt-3 text-sm leading-6">
          Nothing needs to be reset or signed in to again. The app reconnects on
          its own as soon as the network returns.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <a
            href="/dashboard"
            className="bg-brand text-on-accent hover:bg-brand-strong focus-visible:outline-focus inline-flex min-h-11 items-center rounded-xl px-5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            Try again
          </a>
          <a
            href="/install"
            className="border-line text-ink hover:border-brand hover:text-brand focus-visible:outline-focus inline-flex min-h-11 items-center rounded-xl border px-5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            Install Budget App
          </a>
        </div>
      </div>
    </main>
  );
}
