import {
  createMerchantRule,
  getApiContext,
  toApiErrorResponse,
} from "@/lib/categories/service";
import { createRuleSchema } from "@/lib/categories/validation";
export async function POST(request: Request) {
  try {
    const result = await createMerchantRule(
      await getApiContext(),
      createRuleSchema.parse(await request.json()),
    );
    return Response.json(result, { status: 201 });
  } catch (e) {
    return toApiErrorResponse(e);
  }
}
