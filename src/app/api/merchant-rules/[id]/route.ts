import {
  getApiContext,
  toApiErrorResponse,
  updateMerchantRule,
} from "@/lib/categories/service";
import { updateRuleSchema } from "@/lib/categories/validation";
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/merchant-rules/[id]">,
) {
  try {
    const { id } = await ctx.params;
    return Response.json({
      rule: await updateMerchantRule(
        await getApiContext(),
        id,
        updateRuleSchema.parse(await request.json()),
      ),
    });
  } catch (e) {
    return toApiErrorResponse(e);
  }
}
