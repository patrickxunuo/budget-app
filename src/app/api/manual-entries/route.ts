import { ZodError } from "zod";
import {
  createManualEntry,
  getManualEntryContext,
  listManualEntries,
  ManualEntryServiceError,
  manualEntriesToCsv,
  toManualEntryApiErrorResponse,
} from "@/lib/manual-entries/service";
import {
  manualEntryInputSchema,
  manualEntryListQuerySchema,
} from "@/lib/manual-entries/validation";

function routeError(error: unknown) {
  if (error instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of error.issues)
      fields[String(issue.path[0] ?? "request")] ??= issue.message;
    return toManualEntryApiErrorResponse(
      new ManualEntryServiceError(
        400,
        "validation_error",
        "Check the highlighted fields.",
        fields,
      ),
    );
  }
  return toManualEntryApiErrorResponse(error);
}
export async function GET(request: Request) {
  try {
    const context = await getManualEntryContext();
    const url = new URL(request.url);
    const { format, ...filters } = manualEntryListQuerySchema.parse(
      Object.fromEntries(url.searchParams),
    );
    const entries = await listManualEntries(context, filters);
    if (format === "csv")
      return new Response(manualEntriesToCsv(entries), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition":
            'attachment; filename="manual-cash-ledger.csv"',
          "cache-control": "private, no-store",
        },
      });
    return Response.json({ entries });
  } catch (error) {
    return routeError(error);
  }
}
export async function POST(request: Request) {
  try {
    const input = manualEntryInputSchema.parse(await request.json());
    return Response.json(
      { entry: await createManualEntry(await getManualEntryContext(), input) },
      { status: 201 },
    );
  } catch (error) {
    return routeError(error);
  }
}
