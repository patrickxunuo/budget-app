import { buildTransactionExport } from "@/lib/transactions/csv-export";
import {
  getDashboardApiContext,
  toDashboardApiErrorResponse,
} from "@/lib/dashboard/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const context = await getDashboardApiContext();
    const { csv, filename } = await buildTransactionExport(context, query);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 400 || status === 401 || status === 403 || status === 500)
      return Response.json(
        { error: error instanceof Error ? error.message : "Export failed." },
        { status },
      );
    return toDashboardApiErrorResponse(error);
  }
}
