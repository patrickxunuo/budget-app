import {
  getApiContext,
  toApiErrorResponse,
  updateCategory,
} from "@/lib/categories/service";
import { updateCategorySchema } from "@/lib/categories/validation";
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/categories/[id]">,
) {
  try {
    const { id } = await ctx.params;
    return Response.json({
      category: await updateCategory(
        await getApiContext(),
        id,
        updateCategorySchema.parse(await request.json()),
      ),
    });
  } catch (e) {
    return toApiErrorResponse(e);
  }
}
