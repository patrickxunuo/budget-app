import {
  getApiContext,
  previewMerchantRule,
  toApiErrorResponse,
} from "@/lib/categories/service";
import { previewRuleSchema } from "@/lib/categories/validation";
export async function POST(request: Request) {
  try {
    return Response.json(
      await previewMerchantRule(
        await getApiContext(),
        previewRuleSchema.parse(await request.json()),
      ),
    );
  } catch (e) {
    return toApiErrorResponse(e);
  }
}
