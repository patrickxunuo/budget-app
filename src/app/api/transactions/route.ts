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
    const [accountingPlaidEntries, manualEntries] = await Promise.all([
      listTransactions(context, undefined, undefined, filters),
      listManualEntries(context, filters),
    ]);
    const transactions = accountingPlaidEntries.slice(0, limit);
    const accountingTransactions = accountingPlaidEntries.map(
      plaidViewToAccountingTransaction,
    );
    return Response.json({
      transactions,
      manualEntries,
      summary: calculateSummary([
        ...accountingTransactions,
        ...manualEntries.map(manualEntryToAccountingTransaction),
      ]),
    });
  } catch (e) {
    return toApiErrorResponse(e);
  }
}
