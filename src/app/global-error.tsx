"use client";

export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="grid min-h-screen place-items-center bg-[#e8eee9] px-5 text-[#14231c]">
          <div className="w-full max-w-lg rounded-2xl border border-[#cbd6ce] bg-[#f8faf7] p-7">
            <p className="font-mono text-xs tracking-widest text-[#a24f40] uppercase">
              Application unavailable
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">
              Budget App needs a clean restart.
            </h1>
            <p className="mt-4 text-sm leading-6 text-[#5b6c63]">
              Retry the application. No financial transaction was initiated.
            </p>
            <button
              type="button"
              onClick={retry}
              className="mt-6 min-h-11 rounded-xl bg-[#176044] px-5 text-sm font-semibold text-white"
            >
              Restart application
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
