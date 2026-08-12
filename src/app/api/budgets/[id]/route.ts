import {
  budgetHistoryQuerySchema,
  budgetIdSchema,
  updateBudgetSchema,
} from "@/lib/budgets/validation";
import {
  archiveBudgetTarget,
  getBudgetApiContext,
  inspectBudgetTarget,
  reviseBudgetTarget,
  toBudgetApiErrorResponse,
} from "@/lib/budgets/service";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const input = budgetHistoryQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return Response.json(
      await inspectBudgetTarget(
        await getBudgetApiContext(),
        budgetIdSchema.parse(id),
        input.month,
      ),
    );
  } catch (error) {
    return toBudgetApiErrorResponse(error);
  }
}
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const targetId = budgetIdSchema.parse(id);
    const input = updateBudgetSchema.parse(await request.json());
    const context = await getBudgetApiContext();
    const budget =
      "archived" in input
        ? await archiveBudgetTarget(context, targetId, input.effectiveMonth)
        : await reviseBudgetTarget(context, targetId, input);
    return Response.json({ budget });
  } catch (error) {
    return toBudgetApiErrorResponse(error);
  }
}
