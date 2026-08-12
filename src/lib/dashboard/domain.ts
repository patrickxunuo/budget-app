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
export function aggregateDashboard(input: {
  scope: DashboardFilters["scope"];
  period: DashboardFilters["period"];
  range: { startDate: string; endDate: string };
  timeZone: string;
  rows: DashboardTransaction[];
  categories: Array<{ id: string; name: string; color: string | null }>;
  budgets: Array<{ categoryId: string; amountCents: number }>;
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
  const budgetMap = new Map<string, number>();
  for (const budget of input.budgets) {
    budgetMap.set(
      budget.categoryId,
      (budgetMap.get(budget.categoryId) ?? 0) + budget.amountCents,
    );
  }
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
