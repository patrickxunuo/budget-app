import { createCategorySchema } from "@/lib/categories/validation";
import {
  createCategory,
  getApiContext,
  listCategoriesAndRules,
  toApiErrorResponse,
} from "@/lib/categories/service";
export async function GET() {
  try {
    return Response.json(await listCategoriesAndRules(await getApiContext()));
  } catch (e) {
    return toApiErrorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    const input = createCategorySchema.parse(await request.json());
    return Response.json(
      { category: await createCategory(await getApiContext(), input) },
      { status: 201 },
    );
  } catch (e) {
    return toApiErrorResponse(e);
  }
}
