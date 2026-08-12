import {
  calculateSummary,
  getDateRange,
  reconcilePendingTransactions,
} from "@/lib/transactions/accounting";
import type {
  DashboardFilters,
  DashboardReadModel,
  DashboardTransaction,
} from "./types";
export { getDateRange };
export function cadToCents(value: number | string): number {
  const n = typeof value === "number" ? value : Number(value);
  const cents = Math.round(n * 100);
  if (
    !Number.isFinite(n) ||
    !Number.isSafeInteger(cents) ||
    Math.abs(n * 100 - cents) > 0.00001
  )
    throw new RangeError("CAD amount must resolve to safe integer cents");
  return cents;
}
export function moveReference(
  reference: string,
  period: DashboardFilters["period"],
  direction: -1 | 1,
  from?: string,
  to?: string,
) {
  const d = new Date(`${reference}T00:00:00Z`);
  if (period === "day") d.setUTCDate(d.getUTCDate() + direction);
  else if (period === "week") d.setUTCDate(d.getUTCDate() + 7 * direction);
  else if (period === "month") {
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + direction);
  } else {
    const days =
      Math.round(
        (new Date(`${to}T00:00:00Z`).valueOf() -
          new Date(`${from}T00:00:00Z`).valueOf()) /
          86400000,
      ) + 1;
    d.setUTCDate(d.getUTCDate() + days * direction);
  }
  return d.toISOString().slice(0, 10);
}
export function inclusionMatches(
  row: DashboardTransaction,
  inclusion: DashboardFilters["inclusion"],
) {
  if (inclusion === "all") return true;
  if (inclusion === "excluded") return row.excluded;
  if (inclusion === "transfers")
    return row.kind === "transfer" && !row.excluded;
  if (inclusion === "included") return !row.excluded && row.kind !== "transfer";
  return !row.excluded && row.kind !== "transfer";
}
export type DashboardBudgetVersion = {
  categoryId: string;
  amountCents: number;
  effectiveMonth?: string;
  endMonth?: string | null;
};

function firstOfMonth(date: string) {
  return `${date.slice(0, 8)}01`;
}

function monthsTouched(range: { startDate: string; endDate: string }) {
  const months: string[] = [];
  const cursor = new Date(`${firstOfMonth(range.startDate)}T00:00:00Z`);
  const end = firstOfMonth(range.endDate);
  while (cursor.toISOString().slice(0, 10) <= end) {
    months.push(cursor.toISOString().slice(0, 8) + "01");
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

export function aggregateMonthlyBudgetTargets(
  budgets: readonly DashboardBudgetVersion[],
  range: { startDate: string; endDate: string },
) {
  const totals = new Map<string, number>();
  const legacy = budgets.filter(
    (budget) => budget.effectiveMonth === undefined,
  );
  for (const budget of legacy) {
    totals.set(
      budget.categoryId,
      (totals.get(budget.categoryId) ?? 0) + budget.amountCents,
    );
  }

  const versioned = budgets.filter(
    (budget): budget is DashboardBudgetVersion & { effectiveMonth: string } =>
      budget.effectiveMonth !== undefined,
  );
  const categoryIds = new Set(versioned.map((budget) => budget.categoryId));
  for (const month of monthsTouched(range)) {
    for (const categoryId of categoryIds) {
      const applicable = versioned
        .filter(
          (budget) =>
            budget.categoryId === categoryId &&
            budget.effectiveMonth <= month &&
            (budget.endMonth === null ||
              budget.endMonth === undefined ||
              budget.endMonth >= month),
        )
        .sort((left, right) =>
          right.effectiveMonth.localeCompare(left.effectiveMonth),
        )[0];
      if (applicable) {
        totals.set(
          categoryId,
          (totals.get(categoryId) ?? 0) + applicable.amountCents,
        );
      }
    }
  }
  return totals;
}
export function aggregateDashboard(input: {
  scope: DashboardFilters["scope"];
  period: DashboardFilters["period"];
  range: { startDate: string; endDate: string };
  timeZone: string;
  rows: DashboardTransaction[];
  categories: Array<{ id: string; name: string; color: string | null }>;
  budgets: DashboardBudgetVersion[];
  accounts: DashboardReadModel["accounts"];
  filterAccounts?: DashboardReadModel["accounts"];
  filterCategories?: Array<{
    id: string;
    name: string;
    color: string | null;
  }>;
  limit: number;
  aggregateRows?: DashboardTransaction[];
}): DashboardReadModel {
  const accounting = (input.aggregateRows ?? input.rows).map((r) => ({
    id: r.id,
    source: r.source,
    amountCents: r.source === "plaid" ? -r.amountCents : r.amountCents,
    currencyCode: "CAD",
    date: r.date,
    pending: r.pending,
    kindOverride: r.kind,
    excluded: r.excluded,
    categoryId: r.category?.id,
  }));
  const summary = calculateSummary(accounting, input.range);
  const lines = reconcilePendingTransactions(accounting);
  const byDay = new Map<
    string,
    { incomeCents: number; spendingCents: number }
  >();
  let pendingAmountCents = 0;
  let pendingCount = 0;
  for (const l of lines) {
    if (
      l.date < input.range.startDate ||
      l.date > input.range.endDate ||
      l.inclusion !== "included"
    )
      continue;
    const day = byDay.get(l.date) ?? { incomeCents: 0, spendingCents: 0 };
    if (l.kind === "income") day.incomeCents += Math.abs(l.cashFlowCents);
    else if (l.kind === "spending")
      day.spendingCents += Math.abs(l.cashFlowCents);
    else if (l.kind === "refund")
      day.spendingCents -= Math.abs(l.cashFlowCents);
    if (l.pending) {
      pendingAmountCents += Math.abs(l.cashFlowCents);
      pendingCount += 1;
    }
    byDay.set(l.date, day);
  }
  const budgetMap = aggregateMonthlyBudgetTargets(input.budgets, input.range);
  return {
    scope: input.scope,
    period: input.period,
    range: input.range,
    timeZone: input.timeZone,
    summary: {
      incomeCents: summary.incomeCents,
      spendingCents: summary.spendingCents,
      netFlowCents: summary.netFlowCents,
      pendingAmountCents,
      pendingCount,
      includedCount: summary.includedCount,
      excludedCount: summary.excludedCount,
    },
    trend: [...byDay]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v })),
    categories: input.categories
      .map((c) => {
        const spendingCents = summary.categorySpendingCents[c.id] ?? 0;
        const budgetCents = budgetMap.get(c.id) ?? null;
        return {
          ...c,
          spendingCents,
          budgetCents,
          progressPercent:
            budgetCents === null ? null : (spendingCents / budgetCents) * 100,
        };
      })
      .filter((c) => c.spendingCents !== 0 || c.budgetCents !== null),
    accounts: input.accounts,
    transactions: input.rows.slice(0, input.limit),
    filterOptions: {
      accounts: (input.filterAccounts ?? input.accounts).map(
        ({ id, name }) => ({
          id,
          name,
        }),
      ),
      categories: (input.filterCategories ?? input.categories).map(
        ({ id, name }) => ({ id, name }),
      ),
    },
  };
}
