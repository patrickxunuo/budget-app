import type { Metadata } from "next";
import { ManualEntryWorkbench } from "@/components/transactions/manual-entry-workbench";
import { TransactionManagementBackLink } from "@/components/transactions/transaction-management-navigation";
import {
  getApiContext,
  listCategoriesAndRules,
} from "@/lib/categories/service";
import {
  getManualEntryContext,
  listManualEntries,
} from "@/lib/manual-entries/service";
import { formatLocalDate } from "@/lib/transactions/accounting";
import { parseExplorerFilters } from "@/lib/transactions/explorer-filters";
import { resolveTransactionReturnTo } from "@/lib/transactions/management-navigation";
import { delayRouteForE2E } from "@/lib/testing/route-loading-delay";

export const metadata: Metadata = {
  title: "Manual / Cash | Transactions",
  description: "Record and maintain scoped off-bank activity.",
};

export default async function ManualTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await delayRouteForE2E();
  const raw = await searchParams;
  const today = formatLocalDate(new Date(), "America/Toronto");
  const { scope } = parseExplorerFilters(raw, today);
  const [manualContext, apiContext] = await Promise.all([
    getManualEntryContext(),
    getApiContext(),
  ]);
  const [entries, categoryContext] = await Promise.all([
    listManualEntries(manualContext, { scope }),
    listCategoriesAndRules(apiContext),
  ]);
  const categories = categoryContext.categories.filter(
    (category) => !category.archivedAt,
  );
  const returnTo = resolveTransactionReturnTo(raw.returnTo, scope);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-testid="manual-management-page"
      className="min-w-0 overflow-x-hidden px-4 py-5 sm:px-8 sm:py-7 lg:px-12"
    >
      <div className="mx-auto max-w-7xl">
        <header className="border-line mb-8 border-b pb-6">
          <TransactionManagementBackLink href={returnTo} />
          <p className="font-utility text-mineral mt-5 text-[.65rem] font-bold tracking-[.18em] uppercase">
            Transaction management · {scope}
          </p>
          <h1 className="font-display mt-2 text-4xl leading-none font-semibold tracking-[-.04em] sm:text-5xl">
            Manual / Cash register
          </h1>
          <p className="text-muted mt-3 max-w-2xl text-sm leading-6">
            Record off-bank activity with privacy, authorship, and audit history
            kept intact.
          </p>
        </header>
        <ManualEntryWorkbench
          initialEntries={entries}
          categories={categories}
          viewScope={scope}
        />
      </div>
    </main>
  );
}
