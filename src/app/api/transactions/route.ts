import {
  getApiContext,
  listTransactions,
  toApiErrorResponse,
} from "@/lib/categories/service";
import { listManualEntries } from "@/lib/manual-entries/service";
import {
  calculateSummary,
  manualEntryToAccountingTransaction,
  plaidViewToAccountingTransaction,
} from "@/lib/transactions/accounting";
import { transactionListQuerySchema } from "@/lib/categories/validation";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const { limit, ...filters } = transactionListQuerySchema.parse(
      Object.fromEntries(url.searchParams),
    );
    const context = await getApiContext();
    const [allTransactions, manualEntries] = await Promise.all([
      listTransactions(context, undefined, undefined, filters),
      listManualEntries(context, filters),
    ]);
    const visible = [
      ...allTransactions.map((transaction) => ({
        source: "plaid" as const,
        id: transaction.id,
        date: transaction.transactionDate,
      })),
      ...manualEntries.map((entry) => ({
        source: "manual" as const,
        id: entry.id,
        date: entry.entryDate,
      })),
    ]
      .sort(
        (left, right) =>
          right.date.localeCompare(left.date) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, limit);
    const visiblePlaidIds = new Set(
      visible.filter(({ source }) => source === "plaid").map(({ id }) => id),
    );
    const visibleManualIds = new Set(
      visible.filter(({ source }) => source === "manual").map(({ id }) => id),
    );
    return Response.json({
      transactions: allTransactions.filter(({ id }) => visiblePlaidIds.has(id)),
      manualEntries: manualEntries.filter(({ id }) => visibleManualIds.has(id)),
      summary: calculateSummary([
        ...allTransactions.map(plaidViewToAccountingTransaction),
        ...manualEntries.map(manualEntryToAccountingTransaction),
      ]),
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
