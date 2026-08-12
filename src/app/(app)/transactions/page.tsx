import type { Metadata } from "next";
import { ManualEntryWorkbench } from "@/components/transactions/manual-entry-workbench";
import { TransactionLedger } from "@/components/transactions/transaction-ledger";
import {
  getApiContext,
  listCategoriesAndRules,
  listTransactions,
} from "@/lib/categories/service";
import {
  getManualEntryContext,
  listManualEntries,
} from "@/lib/manual-entries/service";
import {
  calculateSummary,
  manualEntryToAccountingTransaction,
  plaidViewToAccountingTransaction,
} from "@/lib/transactions/accounting";

export const metadata: Metadata = {
  title: "Transactions",
  description: "Review connected and off-bank household activity.",
};

export default async function TransactionsPage() {
  const [categoryContext, manualContext] = await Promise.all([
    getApiContext(),
    getManualEntryContext(),
  ]);
  const [accountingPlaidEntries, data, manualEntries] = await Promise.all([
    listTransactions(categoryContext),
    listCategoriesAndRules(categoryContext),
    listManualEntries(manualContext),
  ]);
  const transactions = accountingPlaidEntries.slice(0, 50);
  const activeCategories = data.categories.filter(
    (category) => !category.archivedAt,
  );
  const summary = calculateSummary([
    ...accountingPlaidEntries.map(plaidViewToAccountingTransaction),
    ...manualEntries.map(manualEntryToAccountingTransaction),
  ]);
  const cad = (cents: number) =>
    new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: "CAD",
    }).format(cents / 100);
  return (
    <main className="px-5 py-9 sm:px-8 lg:px-12 lg:py-14">
      <div className="mx-auto max-w-7xl">
        <header className="mb-9 grid gap-5 lg:grid-cols-[1fr_22rem] lg:items-end">
          <div>
            <p className="font-utility text-mineral text-xs font-semibold tracking-[.15em] uppercase">
              Ledger / connected & in hand
            </p>
            <h1 className="font-display mt-3 text-5xl leading-[.94] font-semibold tracking-[-.055em] sm:text-6xl">
              Every dollar has a margin.
            </h1>
          </div>
          <p className="border-line text-muted border-l pl-5 text-sm leading-6">
            Plaid facts remain read-only. Cash and off-bank activity lives in a
            separate, auditable register with the same category language.
          </p>
        </header>

        <section
          aria-label="Combined ledger summary"
          className="border-line bg-panel mb-9 grid overflow-hidden rounded-2xl border sm:grid-cols-3"
          data-testid="combined-ledger-summary"
        >
          {[
            ["Income", summary.incomeCents, "combined-summary-income"],
            [
              "Spending after refunds",
              summary.spendingCents,
              "combined-summary-spending",
            ],
            ["Net flow", summary.netFlowCents, "combined-summary-net"],
          ].map(([label, cents, testId]) => (
            <div
              key={String(label)}
              className="border-line px-5 py-4 not-last:border-b sm:not-last:border-r sm:not-last:border-b-0"
            >
              <p className="font-utility text-muted text-[.62rem] font-semibold tracking-[.14em] uppercase">
                {label}
              </p>
              <p
                className="font-display text-ink mt-2 text-2xl font-semibold tabular-nums"
                data-testid={String(testId)}
              >
                {cad(Number(cents))}
              </p>
            </div>
          ))}
          <p className="text-muted border-line col-span-full border-t px-5 py-3 text-xs leading-5">
            Plaid and Manual/Cash records share these category and budget
            totals; Manual rows never enter Plaid pending reconciliation.
          </p>
        </section>

        <section aria-labelledby="manual-ledger-title" className="mb-16">
          <div className="sr-only">
            <h2 id="manual-ledger-title">Manual and cash ledger</h2>
          </div>
          <ManualEntryWorkbench
            initialEntries={manualEntries}
            categories={activeCategories}
          />
        </section>

        <section
          aria-labelledby="plaid-ledger-title"
          className="border-line border-t pt-10"
        >
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
            <h2
              id="plaid-ledger-title"
              className="font-display text-3xl font-semibold"
            >
              Plaid register
            </h2>
            <p className="font-utility text-muted text-[.65rem] tracking-[.14em] uppercase">
              Connected source — read-only facts
            </p>
          </div>
          <TransactionLedger
            initialTransactions={transactions}
            categories={data.categories}
          />
        </section>
      </div>
    </main>
  );
}
