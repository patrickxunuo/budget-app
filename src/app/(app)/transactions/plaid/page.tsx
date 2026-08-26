import type { Metadata } from "next";
import { TransactionLedger } from "@/components/transactions/transaction-ledger";
import { TransactionManagementBackLink } from "@/components/transactions/transaction-management-navigation";
import {
  getApiContext,
  listCategoriesAndRules,
  listTransactions,
} from "@/lib/categories/service";
import { formatLocalDate } from "@/lib/transactions/accounting";
import { parseExplorerFilters } from "@/lib/transactions/explorer-filters";
import { resolveTransactionReturnTo } from "@/lib/transactions/management-navigation";
import { delayRouteForE2E } from "@/lib/testing/route-loading-delay";

export const metadata: Metadata = {
  title: "Plaid Categories | Transactions",
  description: "Manage scoped Plaid transaction categories and merchant rules.",
};

const LEDGER_LIMIT = 50;

export default async function PlaidTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await delayRouteForE2E();
  const raw = await searchParams;
  const today = formatLocalDate(new Date(), "America/Toronto");
  const { scope } = parseExplorerFilters(raw, today);
  const context = await getApiContext();
  const [transactions, categoryContext] = await Promise.all([
    listTransactions(context, undefined, undefined, { scope }),
    listCategoriesAndRules(context),
  ]);
  const categories = categoryContext.categories;
  const returnTo = resolveTransactionReturnTo(raw.returnTo, scope);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-testid="plaid-management-page"
      className="min-w-0 overflow-x-hidden px-4 py-5 sm:px-8 sm:py-7 lg:px-12"
    >
      <div className="mx-auto max-w-7xl">
        <header className="border-line mb-8 border-b pb-6">
          <TransactionManagementBackLink href={returnTo} />
          <p className="font-utility text-brand mt-5 text-[.65rem] font-bold tracking-[.18em] uppercase">
            Transaction management · {scope}
          </p>
          <h1 className="font-display mt-2 text-4xl leading-none font-semibold tracking-[-.04em] sm:text-5xl">
            Plaid register
          </h1>
          <p className="text-muted mt-3 max-w-2xl text-sm leading-6">
            Review connected-source facts, save one-off categories, or turn a
            stable merchant match into a reusable rule.
          </p>
        </header>
        <TransactionLedger
          initialTransactions={transactions.slice(0, LEDGER_LIMIT)}
          categories={categories}
        />
      </div>
    </main>
  );
}
