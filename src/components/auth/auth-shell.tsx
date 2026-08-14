import Link from "next/link";
import { LedgerMark } from "@/components/ledger-mark";

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
}: Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}>) {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen px-4 py-4 sm:px-8 sm:py-8">
      <section className="border-line bg-surface mx-auto grid min-h-[calc(100vh-2rem)] max-w-6xl overflow-hidden rounded-[1.75rem] border shadow-[0_26px_90px_rgba(18,44,33,.14)] sm:min-h-[calc(100vh-4rem)] lg:grid-cols-[.78fr_1.22fr]">
        <aside className="bg-ink text-panel relative flex min-h-72 flex-col justify-between overflow-hidden p-7 sm:p-10 lg:p-12">
          <div className="bg-mineral/20 absolute -top-24 -right-24 size-80 rounded-full blur-3xl" />
          <Link
            href="/"
            className="relative flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            <LedgerMark className="text-brand" />
            <span className="font-display text-xl font-semibold">
              Budget App
            </span>
          </Link>
          <div className="relative">
            <p className="font-utility text-brand text-[.68rem] font-semibold tracking-[.16em] uppercase">
              Household ledger / private by design
            </p>
            <p className="font-display mt-5 max-w-sm text-4xl leading-[.95] font-semibold tracking-[-.055em] sm:text-5xl">
              A small door for the people who belong.
            </p>
          </div>
          <p className="font-utility text-panel/55 relative text-[.62rem] tracking-[.12em] uppercase">
            Canada · CAD · Read-only bank access
          </p>
        </aside>
        <div className="flex items-center px-5 py-10 sm:px-10 lg:px-16">
          <div className="w-full max-w-xl">
            <p className="font-utility text-brand text-[.68rem] font-semibold tracking-[.16em] uppercase">
              {eyebrow}
            </p>
            <h1 className="font-display text-ink mt-3 text-5xl leading-[.95] font-semibold tracking-[-.06em] sm:text-6xl">
              {title}
            </h1>
            <p className="text-muted mt-5 max-w-lg text-sm leading-7 sm:text-base">
              {description}
            </p>
            <div className="mt-9">{children}</div>
          </div>
        </div>
      </section>
    </main>
  );
}
