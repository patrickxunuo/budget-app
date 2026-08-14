import type { Metadata } from "next";
import { BudgetWorkbench } from "@/components/budgets/budget-workbench";
import { getBudgetApiContext, readBudgetMonth } from "@/lib/budgets/service";
import { formatLocalDate } from "@/lib/transactions/accounting";
export const metadata: Metadata = {
  title: "Monthly budgets",
  description:
    "Recurring Family and Personal category targets in Canadian dollars.",
};
export default async function BudgetsPage() {
  const today = formatLocalDate(new Date(), "America/Toronto");
  const month = `${today.slice(0, 8)}01`;
  const initialModel = await readBudgetMonth(
    await getBudgetApiContext(),
    "family",
    month,
  );
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-w-0 overflow-x-hidden px-4 py-8 sm:px-8 lg:px-12 lg:py-14"
    >
      <div className="mx-auto max-w-7xl">
        <BudgetWorkbench initialModel={initialModel} />
      </div>
    </main>
  );
}
