import {
  budgetMonthQuerySchema,
  createBudgetSchema,
} from "@/lib/budgets/validation";
import {
  createBudgetTarget,
  getBudgetApiContext,
  readBudgetMonth,
  toBudgetApiErrorResponse,
} from "@/lib/budgets/service";
export async function GET(request: Request) {
  try {
    const input = budgetMonthQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return Response.json(
      await readBudgetMonth(
        await getBudgetApiContext(),
        input.scope,
        input.month,
      ),
    );
  } catch (error) {
    return toBudgetApiErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    const input = createBudgetSchema.parse(await request.json());
    return Response.json(
      { budget: await createBudgetTarget(await getBudgetApiContext(), input) },
      { status: 201 },
    );
  } catch (error) {
    return toBudgetApiErrorResponse(error);
  }
}
