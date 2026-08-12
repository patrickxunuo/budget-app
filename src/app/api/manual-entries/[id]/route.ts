import { ZodError } from "zod";
import {
  deleteManualEntry,
  getManualEntryContext,
  ManualEntryServiceError,
  toManualEntryApiErrorResponse,
  updateManualEntry,
} from "@/lib/manual-entries/service";
import {
  manualEntryDeleteSchema,
  manualEntryIdSchema,
  manualEntryUpdateSchema,
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
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/manual-entries/[id]">,
) {
  try {
    const id = manualEntryIdSchema.parse((await ctx.params).id);
    const input = manualEntryUpdateSchema.parse(await request.json());
    return Response.json({
      entry: await updateManualEntry(await getManualEntryContext(), id, input),
    });
  } catch (error) {
    return routeError(error);
  }
}
export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/manual-entries/[id]">,
) {
  try {
    const id = manualEntryIdSchema.parse((await ctx.params).id);
    const { confirmed } = manualEntryDeleteSchema.parse(await request.json());
    return Response.json({
      entry: await deleteManualEntry(
        await getManualEntryContext(),
        id,
        confirmed,
      ),
    });
  } catch (error) {
    return routeError(error);
  }
}
