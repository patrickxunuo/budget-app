import type { Metadata } from "next";
import { TransactionLedger } from "@/components/transactions/transaction-ledger";
import {
  getApiContext,
  listCategoriesAndRules,
  listTransactions,
} from "@/lib/categories/service";
export const metadata: Metadata = {
  title: "Transactions",
  description: "Review Plaid facts and household classifications.",
};
export default async function TransactionsPage() {
  const ctx = await getApiContext();
  const [transactions, data] = await Promise.all([
    listTransactions(ctx, 50),
    listCategoriesAndRules(ctx),
  ]);
  return (
    <main className="px-5 py-9 sm:px-8 lg:px-12 lg:py-14">
      <div className="mx-auto max-w-7xl">
        <header className="mb-9 grid gap-5 lg:grid-cols-[1fr_22rem] lg:items-end">
          <div>
            <p className="font-utility text-mineral text-xs font-semibold tracking-[.15em] uppercase">
              Ledger / source & judgment
            </p>
            <h1 className="font-display mt-3 text-5xl leading-[.94] font-semibold tracking-[-.055em] sm:text-6xl">
              Read the story twice.
            </h1>
          </div>
          <p className="border-line text-muted border-l pl-5 text-sm leading-6">
            Plaid’s original category stays visible. Your effective category
            records the household’s judgment without rewriting the source.
          </p>
        </header>
        <TransactionLedger
          initialTransactions={transactions}
          categories={data.categories}
        />
      </div>
    </main>
  );
}
