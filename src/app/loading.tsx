export default function Loading() {
  return (
    <main className="grid min-h-screen place-items-center px-5">
      <div className="w-full max-w-lg" aria-live="polite" aria-busy="true">
        <p className="font-utility text-brand text-[0.68rem] tracking-[0.14em] uppercase">
          Opening ledger
        </p>
        <div className="bg-line mt-4 h-2 overflow-hidden rounded-full">
          <div className="bg-brand h-full w-1/3 rounded-full" />
        </div>
      </div>
    </main>
  );
}
