import {
  getApiContext,
  setManualCategory,
  toApiErrorResponse,
} from "@/lib/categories/service";
import { manualCategorySchema } from "@/lib/categories/validation";
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/transactions/[id]/category">,
) {
  try {
    const { id } = await ctx.params;
    const { categoryId } = manualCategorySchema.parse(await request.json());
    return Response.json({
      transaction: await setManualCategory(
        await getApiContext(),
        id,
        categoryId,
      ),
    });
  } catch (e) {
    return toApiErrorResponse(e);
  }
}
