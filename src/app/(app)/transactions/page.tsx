import type { Metadata } from "next";
import { TransactionExplorer } from "@/components/transactions/transaction-explorer";
import { getApiContext } from "@/lib/categories/service";
import { readDashboard } from "@/lib/dashboard/service";
import { formatLocalDate } from "@/lib/transactions/accounting";
import {
  parseExplorerFilters,
  toExplorerSearchParams,
  toReadModelQuery,
} from "@/lib/transactions/explorer-filters";
import { delayRouteForE2E } from "@/lib/testing/route-loading-delay";

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
  const context = await getApiContext();
  const explorerModel = await readDashboard(context, {
    ...toReadModelQuery(filters),
    limit: EXPLORER_LIMIT,
  });
  const explorerKey = toExplorerSearchParams(filters);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-w-0 overflow-x-hidden px-4 py-5 sm:px-8 sm:py-7 lg:px-12"
    >
      <div className="mx-auto max-w-7xl">
        <TransactionExplorer
          key={explorerKey}
          initialModel={explorerModel}
          initialFilters={filters}
        />
      </div>
    </main>
  );
}
