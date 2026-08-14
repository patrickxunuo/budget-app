"use client";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="grid min-h-screen place-items-center px-5"
    >
      <div className="border-line bg-surface w-full max-w-lg rounded-2xl border p-7 shadow-xl">
        <p className="font-utility text-alert text-[0.68rem] tracking-[0.14em] uppercase">
          Route unavailable
        </p>
        <h1 className="font-display text-ink mt-3 text-4xl font-semibold tracking-[-0.05em]">
          This view could not be loaded.
        </h1>
        <p className="text-muted mt-4 text-sm leading-6">
          Try the request again. No bank action was performed.
          {error.digest ? ` Reference: ${error.digest}.` : ""}
        </p>
        <button
          type="button"
          onClick={retry}
          className="bg-brand focus-visible:outline-brand text-on-accent mt-6 min-h-11 rounded-xl px-5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
