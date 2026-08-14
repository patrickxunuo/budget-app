import Link from "next/link";

export default function NotFound() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="grid min-h-screen place-items-center px-5"
    >
      <div className="border-line bg-surface w-full max-w-lg rounded-2xl border p-7">
        <p className="font-utility text-muted text-[0.68rem] tracking-[0.14em] uppercase">
          404 / No entry
        </p>
        <h1 className="font-display text-ink mt-3 text-4xl font-semibold tracking-[-0.05em]">
          This page is not in the ledger.
        </h1>
        <p className="text-muted mt-4 text-sm leading-6">
          Return to the application foundation and choose an available view.
        </p>
        <Link
          href="/"
          className="bg-brand focus-visible:outline-brand text-on-accent mt-6 inline-flex min-h-11 items-center rounded-xl px-5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          Return home
        </Link>
      </div>
    </main>
  );
}
