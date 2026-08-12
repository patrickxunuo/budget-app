import {
  getApiContext,
  listTransactions,
  toApiErrorResponse,
} from "@/lib/categories/service";
import { transactionListQuerySchema } from "@/lib/categories/validation";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const { limit } = transactionListQuerySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
    });
    return Response.json({
      transactions: await listTransactions(await getApiContext(), limit),
    });
  } catch (e) {
    return toApiErrorResponse(e);
  }
}
