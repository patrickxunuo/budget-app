import type { BudgetProgress, BudgetStatus, BudgetTarget } from "./types";
export function monthEnd(month: string): string {
  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5, 7));
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}
export function moveMonth(month: string, direction: -1 | 1): string {
  const date = new Date(`${month}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + direction);
  return date.toISOString().slice(0, 8) + "01";
}
export function budgetStatus(percentageUsed: number): BudgetStatus {
  if (percentageUsed < 75) return "on-track";
  if (percentageUsed < 90) return "watch";
  if (percentageUsed < 100) return "close";
  if (percentageUsed === 100) return "at-limit";
  return "over";
}
export function calculateBudgetProgress(
  target: BudgetTarget,
  spentCents: number,
): BudgetProgress {
  if (!Number.isSafeInteger(spentCents))
    throw new TypeError("spentCents must be safe integer cents");
  const remainingCents = Math.max(target.amountCents - spentCents, 0);
  const overBudgetCents = Math.max(spentCents - target.amountCents, 0);
  const percentageUsed = (Math.max(spentCents, 0) / target.amountCents) * 100;
  return {
    ...target,
    spentCents,
    remainingCents,
    overBudgetCents,
    percentageUsed,
    status: budgetStatus(percentageUsed),
  };
}
export function sumBudgetProgress(budgets: readonly BudgetProgress[]) {
  return budgets.reduce(
    (sum, budget) => ({
      targetCents: sum.targetCents + budget.amountCents,
      spentCents: sum.spentCents + budget.spentCents,
      remainingCents: sum.remainingCents + budget.remainingCents,
      overBudgetCents: sum.overBudgetCents + budget.overBudgetCents,
    }),
    { targetCents: 0, spentCents: 0, remainingCents: 0, overBudgetCents: 0 },
  );
}
