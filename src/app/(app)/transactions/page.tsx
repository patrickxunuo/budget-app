import type { Metadata } from "next";
import { ManualEntryWorkbench } from "@/components/transactions/manual-entry-workbench";
import { TransactionExplorer } from "@/components/transactions/transaction-explorer";
import { TransactionLedger } from "@/components/transactions/transaction-ledger";
import {
  getApiContext,
  listCategoriesAndRules,
  listTransactions,
} from "@/lib/categories/service";
import { readDashboard } from "@/lib/dashboard/service";
import {
  getManualEntryContext,
  listManualEntries,
} from "@/lib/manual-entries/service";
import { formatLocalDate } from "@/lib/transactions/accounting";
import { delayRouteForE2E } from "@/lib/testing/route-loading-delay";
import {
  parseExplorerFilters,
  toExplorerSearchParams,
  toReadModelQuery,
} from "@/lib/transactions/explorer-filters";

export const metadata: Metadata = {
  title: "Transactions",
  description: "Review connected and off-bank household activity.",
};

const EXPLORER_LIMIT = 50;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await delayRouteForE2E();
  const today = formatLocalDate(new Date(), "America/Toronto");
  const filters = parseExplorerFilters(await searchParams, today);
  const scope = filters.scope;
  const [context, manualContext] = await Promise.all([
    getApiContext(),
    getManualEntryContext(),
  ]);
  const [accountingPlaidEntries, data, manualEntries, explorerModel] =
    await Promise.all([
      listTransactions(context, undefined, undefined, { scope }),
      listCategoriesAndRules(context),
      listManualEntries(manualContext, { scope }),
      // The explorer's summary and ledger are filter-faithful: the same read
      // model the client refetches, seeded so first paint costs no request.
      readDashboard(context, {
        ...toReadModelQuery(filters),
        limit: EXPLORER_LIMIT,
      }),
    ]);
  const explorerKey = toExplorerSearchParams(filters);
  const transactions = accountingPlaidEntries.slice(0, EXPLORER_LIMIT);
  const activeCategories = data.categories.filter(
    (category) => !category.archivedAt,
  );
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-w-0 overflow-x-hidden px-4 py-5 sm:px-8 sm:py-7 lg:px-12"
    >
      <div className="mx-auto max-w-7xl">
        {/* Keyed on the whole applied query, not just scope. The explorer seeds
            `useState` from these props and ignores later changes to them, so a
            navigation whose applied query differs from the last render's — a
            scope switch, a shared link, back/forward — has to remount it or the
            screen keeps a view the address bar no longer describes. Filter
            changes sync the URL with `replaceState`, which does not re-render
            this server component, so the key is stable across them.

            Known limit: a key cannot catch a return to a URL the server already
            rendered once. Land on a bare /transactions, apply filters (client
            side only), then click the nav's own /transactions link: the server
            sees identical input both times, emits the same key, and the filtered
            view survives under a bare URL until the next reload. Narrow, and
            never a scope or privacy mismatch — any scope difference does change
            the key. Closing it needs the explorer to reconcile against
            `useSearchParams()`, which is follow-up work, not this ticket. */}
        <TransactionExplorer
          key={explorerKey}
          initialModel={explorerModel}
          initialFilters={filters}
        />

        <section aria-labelledby="manual-ledger-title" className="mb-16">
          <div className="sr-only">
            <h2 id="manual-ledger-title">Manual and cash ledger</h2>
          </div>
          <ManualEntryWorkbench
            initialEntries={manualEntries}
            categories={activeCategories}
            viewScope={scope}
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
