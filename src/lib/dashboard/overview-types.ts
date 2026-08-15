import type { AccountingTransaction } from "@/lib/transactions/accounting";
import type { DashboardScope } from "./types";

export type DashboardOverviewReadModel = {
  scope: DashboardScope;
  timeZone: "America/Toronto";
  asOfDate: string;
  range: { startDate: string; endDate: string };
  budgetHealth: {
    hasBudgets: boolean;
    targetCents: number | null;
    spentCents: number;
    remainingCents: number | null;
    progressPercent: number | null;
    daysElapsed: number;
    daysRemaining: number;
    daysInMonth: number;
    expectedPercent: number;
    pace: "under" | "at" | "over" | null;
  };
  comparison: {
    baselineMonthCount: 0 | 1 | 2 | 3;
    points: Array<{
      day: number;
      date: string;
      currentCumulativeCents: number;
      baselineAverageCents: number | null;
    }>;
  };
  accounts: Array<{
    id: string;
    name: string;
    mask: string | null;
    subtype: "chequing" | "savings" | "credit_card";
    availableCents: number | null;
    currentCents: number | null;
    freshnessAt: string | null;
  }>;
};

export type DashboardOverviewCalendar = {
  timeZone: "America/Toronto";
  asOfDate: string;
  range: { startDate: string; endDate: string };
  daysElapsed: number;
  daysRemaining: number;
  daysInMonth: number;
  historyStartDate: string;
};

export type DashboardOverviewBudgetVersion = {
  categoryId: string;
  amountCents: number;
  effectiveMonth: string;
  endMonth: string | null;
};

export type DashboardOverviewInput = {
  scope: DashboardScope;
  calendar: DashboardOverviewCalendar;
  transactions: readonly AccountingTransaction[];
  budgets: readonly DashboardOverviewBudgetVersion[];
  accounts: DashboardOverviewReadModel["accounts"];
};
