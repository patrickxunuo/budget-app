export type BudgetScope = "family" | "personal";
export type BudgetStatus = "on-track" | "watch" | "close" | "at-limit" | "over";
export type BudgetTarget = {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string | null;
  scope: BudgetScope;
  amountCents: number;
  currencyCode: "CAD";
  effectiveMonth: string;
  endMonth: string | null;
  archived: boolean;
};
export type BudgetProgress = BudgetTarget & {
  spentCents: number;
  remainingCents: number;
  overBudgetCents: number;
  percentageUsed: number;
  status: BudgetStatus;
};
export type BudgetMonthReadModel = {
  scope: BudgetScope;
  month: string;
  monthEnd: string;
  currencyCode: "CAD";
  budgets: BudgetProgress[];
  availableCategories: Array<{
    id: string;
    name: string;
    color: string | null;
  }>;
  summary: {
    targetCents: number;
    spentCents: number;
    remainingCents: number;
    overBudgetCents: number;
  };
};
