import {
  formatLocalDate,
  reconcilePendingTransactions,
} from "@/lib/transactions/accounting";
import type { AccountingLine } from "@/lib/transactions/accounting";
import type {
  DashboardOverviewCalendar,
  DashboardOverviewInput,
  DashboardOverviewReadModel,
} from "./overview-types";

const TIME_ZONE = "America/Toronto" as const;
const DAY_MS = 86_400_000;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(value: string, field = "date") {
  const match = LOCAL_DATE.exec(value);
  if (!match) throw new RangeError(`${field} must be a valid YYYY-MM-DD date`);
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  ) {
    throw new RangeError(`${field} must be a valid YYYY-MM-DD date`);
  }
  return date;
}

function dateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function daysIn(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

function checkedCents(value: number, field: string) {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${field} must be safe integer cents`);
  }
  return value;
}

function addCents(left: number, right: number, field: string) {
  return checkedCents(left + right, field);
}

function spendingDelta(line: AccountingLine) {
  if (line.inclusion !== "included") return null;
  if (line.kind === "spending") return Math.abs(line.cashFlowCents);
  if (line.kind === "refund") return -Math.abs(line.cashFlowCents);
  return null;
}

function roundedAverage(total: number, count: number) {
  const result = Math.round(total / count);
  return Object.is(result, -0) ? 0 : result;
}

export function resolveTorontoMonth(
  instant: Date | string | number = new Date(),
): DashboardOverviewCalendar {
  const asOfDate = formatLocalDate(instant, TIME_ZONE);
  const current = parseDate(asOfDate, "asOfDate");
  const start = monthStart(current);
  const monthDays = daysIn(current);
  const historyStart = new Date(start);
  historyStart.setUTCMonth(historyStart.getUTCMonth() - 3);
  return {
    timeZone: TIME_ZONE,
    asOfDate,
    range: { startDate: dateString(start), endDate: asOfDate },
    daysElapsed: current.getUTCDate(),
    daysRemaining: monthDays - current.getUTCDate(),
    daysInMonth: monthDays,
    historyStartDate: dateString(historyStart),
  };
}

function effectiveBudgets(input: DashboardOverviewInput) {
  const currentMonth = input.calendar.range.startDate;
  const byCategory = new Map<
    string,
    DashboardOverviewInput["budgets"][number]
  >();
  for (const budget of input.budgets) {
    checkedCents(budget.amountCents, `budget ${budget.categoryId}`);
    if (budget.amountCents < 0) {
      throw new RangeError("budget targets cannot be negative");
    }
    if (
      budget.effectiveMonth > currentMonth ||
      (budget.endMonth !== null && budget.endMonth < currentMonth)
    ) {
      continue;
    }
    const previous = byCategory.get(budget.categoryId);
    if (!previous || previous.effectiveMonth < budget.effectiveMonth) {
      byCategory.set(budget.categoryId, budget);
    }
  }
  return byCategory;
}

function paceFor(
  spentCents: number,
  targetCents: number,
  calendar: DashboardOverviewCalendar,
) {
  if (targetCents === 0) {
    return calendar.daysElapsed / calendar.daysInMonth <= 0.01 ? "at" : "under";
  }
  const actualCross = BigInt(spentCents) * BigInt(calendar.daysInMonth);
  const expectedCross = BigInt(targetCents) * BigInt(calendar.daysElapsed);
  const distance = actualCross - expectedCross;
  const tolerance = BigInt(targetCents) * BigInt(calendar.daysInMonth);
  if (distance * BigInt(100) < -tolerance) return "under";
  if (distance * BigInt(100) > tolerance) return "over";
  return "at";
}

export function buildDashboardOverview(
  input: DashboardOverviewInput,
): DashboardOverviewReadModel {
  const currentStart = parseDate(
    input.calendar.range.startDate,
    "range.startDate",
  );
  const currentEnd = parseDate(input.calendar.range.endDate, "range.endDate");
  if (
    currentStart > currentEnd ||
    input.calendar.asOfDate !== input.calendar.range.endDate
  ) {
    throw new RangeError("overview calendar range is invalid");
  }

  const lines = reconcilePendingTransactions(input.transactions);
  const currentDaily = new Map<number, number>();
  const previousMonths = [1, 2, 3].map((offset) => {
    const start = new Date(currentStart);
    start.setUTCMonth(start.getUTCMonth() - offset);
    return {
      key: dateString(start).slice(0, 7),
      daysInMonth: daysIn(start),
      daily: new Map<number, number>(),
      hasRows: false,
    };
  });

  for (const line of lines) {
    const delta = spendingDelta(line);
    if (delta === null) continue;
    checkedCents(delta, `transaction ${line.id}`);
    const transactionDate = parseDate(line.date, `transaction ${line.id} date`);
    const key = line.date.slice(0, 7);
    if (transactionDate >= currentStart && transactionDate <= currentEnd) {
      const day = transactionDate.getUTCDate();
      currentDaily.set(
        day,
        addCents(currentDaily.get(day) ?? 0, delta, "current daily spend"),
      );
      continue;
    }
    const prior = previousMonths.find((month) => month.key === key);
    if (!prior) continue;
    prior.hasRows = true;
    const day = transactionDate.getUTCDate();
    prior.daily.set(
      day,
      addCents(prior.daily.get(day) ?? 0, delta, "baseline daily spend"),
    );
  }

  const availableMonths = previousMonths.filter((month) => month.hasRows);
  const priorCumulative = new Map<string, number[]>();
  for (const month of availableMonths) {
    let cumulative = 0;
    const values = [0];
    for (let day = 1; day <= month.daysInMonth; day += 1) {
      cumulative = addCents(
        cumulative,
        month.daily.get(day) ?? 0,
        "baseline cumulative spend",
      );
      values.push(cumulative);
    }
    priorCumulative.set(month.key, values);
  }

  let currentCumulative = 0;
  const points: DashboardOverviewReadModel["comparison"]["points"] = [];
  for (let day = 1; day <= input.calendar.daysElapsed; day += 1) {
    currentCumulative = addCents(
      currentCumulative,
      currentDaily.get(day) ?? 0,
      "current cumulative spend",
    );
    let baselineAverageCents: number | null = null;
    if (availableMonths.length > 0) {
      let total = 0;
      for (const month of availableMonths) {
        const values = priorCumulative.get(month.key)!;
        total = addCents(
          total,
          values[Math.min(day, month.daysInMonth)] ?? 0,
          "baseline average total",
        );
      }
      baselineAverageCents = roundedAverage(total, availableMonths.length);
    }
    const date = new Date(currentStart.getTime() + (day - 1) * DAY_MS);
    points.push({
      day,
      date: dateString(date),
      currentCumulativeCents: currentCumulative,
      baselineAverageCents,
    });
  }

  const budgets = effectiveBudgets(input);
  let targetCents = 0;
  for (const budget of budgets.values()) {
    targetCents = addCents(targetCents, budget.amountCents, "budget target");
  }
  let budgetedSpentCents = 0;
  if (budgets.size > 0) {
    for (const line of lines) {
      const delta = spendingDelta(line);
      if (
        delta !== null &&
        line.date >= input.calendar.range.startDate &&
        line.date <= input.calendar.range.endDate &&
        line.categoryId &&
        budgets.has(line.categoryId)
      ) {
        budgetedSpentCents = addCents(
          budgetedSpentCents,
          delta,
          "budgeted spend",
        );
      }
    }
  }
  const hasBudgets = budgets.size > 0;
  const spentCents = hasBudgets ? budgetedSpentCents : currentCumulative;
  const remainingCents = hasBudgets
    ? addCents(targetCents, -spentCents, "budget remaining")
    : null;
  const progressPercent = hasBudgets
    ? targetCents === 0
      ? 0
      : (spentCents / targetCents) * 100
    : null;

  return {
    scope: input.scope,
    timeZone: TIME_ZONE,
    asOfDate: input.calendar.asOfDate,
    range: { ...input.calendar.range },
    budgetHealth: {
      hasBudgets,
      targetCents: hasBudgets ? targetCents : null,
      spentCents,
      remainingCents,
      progressPercent:
        progressPercent === null
          ? null
          : Number.isFinite(progressPercent)
            ? progressPercent
            : 0,
      daysElapsed: input.calendar.daysElapsed,
      daysRemaining: input.calendar.daysRemaining,
      daysInMonth: input.calendar.daysInMonth,
      expectedPercent:
        (input.calendar.daysElapsed / input.calendar.daysInMonth) * 100,
      pace: hasBudgets
        ? paceFor(spentCents, targetCents, input.calendar)
        : null,
    },
    comparison: {
      baselineMonthCount: availableMonths.length as 0 | 1 | 2 | 3,
      points,
    },
    accounts: input.accounts.map((account) => ({ ...account })),
  };
}
