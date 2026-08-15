import { describe, expect, it } from "vitest";

import type { AccountingTransaction } from "@/lib/transactions/accounting";
import { buildDashboardOverview, resolveTorontoMonth } from "./overview-domain";
import type { DashboardOverviewReadModel } from "./overview-types";

function transaction(
  id: string,
  date: string,
  amountCents: number,
  overrides: Partial<AccountingTransaction> = {},
): AccountingTransaction {
  return {
    id,
    source: "manual",
    amountCents,
    currencyCode: "CAD",
    date,
    kindOverride: amountCents >= 0 ? "refund" : "spending",
    categoryId: "groceries",
    ...overrides,
  };
}

const noAccounts: DashboardOverviewReadModel["accounts"] = [];

function model(
  instant: string,
  transactions: readonly AccountingTransaction[],
  budgets: ReadonlyArray<{
    categoryId: string;
    amountCents: number;
    effectiveMonth: string;
    endMonth: string | null;
  }> = [],
) {
  return buildDashboardOverview({
    scope: "family",
    calendar: resolveTorontoMonth(instant),
    transactions,
    budgets,
    accounts: noAccounts,
  });
}

describe("GH-31 dashboard overview domain", () => {
  it("UNIT-001 resolves the request instant in Toronto before choosing today's month", () => {
    const beforeTorontoMidnight = resolveTorontoMonth(
      "2026-09-01T03:59:59.000Z",
    );
    expect(beforeTorontoMidnight).toEqual({
      timeZone: "America/Toronto",
      asOfDate: "2026-08-31",
      range: { startDate: "2026-08-01", endDate: "2026-08-31" },
      daysElapsed: 31,
      daysRemaining: 0,
      daysInMonth: 31,
      historyStartDate: "2026-05-01",
    });

    expect(resolveTorontoMonth("2026-09-01T04:00:00.000Z")).toMatchObject({
      asOfDate: "2026-09-01",
      range: { startDate: "2026-09-01", endDate: "2026-09-01" },
      daysElapsed: 1,
      daysRemaining: 29,
      daysInMonth: 30,
    });
  });

  it("UNIT-002 aggregates effective category targets, categorized spend/refunds, day counts, and pace", () => {
    const overview = model(
      "2026-08-12T16:00:00.000Z",
      [
        transaction("grocery-spend", "2026-08-03", -12_000),
        transaction("grocery-refund", "2026-08-05", 2_000),
        transaction("dining-spend", "2026-08-08", -5_000, {
          categoryId: "dining",
        }),
        transaction("unbudgeted", "2026-08-09", -9_000, {
          categoryId: "travel",
        }),
      ],
      [
        {
          categoryId: "groceries",
          amountCents: 50_000,
          effectiveMonth: "2026-01-01",
          endMonth: null,
        },
        {
          categoryId: "dining",
          amountCents: 20_000,
          effectiveMonth: "2026-08-01",
          endMonth: null,
        },
      ],
    );

    expect(overview.budgetHealth).toMatchObject({
      hasBudgets: true,
      targetCents: 70_000,
      spentCents: 15_000,
      remainingCents: 55_000,
      daysElapsed: 12,
      daysRemaining: 19,
      daysInMonth: 31,
      pace: "under",
    });
    expect(overview.budgetHealth.progressPercent).toBeCloseTo(
      (15_000 / 70_000) * 100,
      8,
    );
    expect(overview.budgetHealth.expectedPercent).toBeCloseTo(
      (12 / 31) * 100,
      8,
    );
  });

  it("UNIT-003 returns a plain no-budget model while retaining all included month spending", () => {
    const overview = model("2026-08-03T16:00:00.000Z", [
      transaction("groceries", "2026-08-01", -10_000),
      transaction("travel-refund", "2026-08-02", 2_000, {
        categoryId: "travel",
      }),
    ]);

    expect(overview.budgetHealth).toMatchObject({
      hasBudgets: false,
      targetCents: null,
      spentCents: 8_000,
      remainingCents: null,
      progressPercent: null,
      daysElapsed: 3,
      daysRemaining: 28,
      daysInMonth: 31,
      pace: null,
    });
    expect(JSON.stringify(overview)).not.toContain("NaN");
  });

  it("UNIT-004 carries cumulative spend across missing days and never projects beyond today", () => {
    const overview = model("2026-08-04T16:00:00.000Z", [
      transaction("day-one", "2026-08-01", -100),
      transaction("day-three", "2026-08-03", -200),
      transaction("tomorrow", "2026-08-05", -9_999),
    ]);

    expect(
      overview.comparison.points.map((point) => ({
        day: point.day,
        date: point.date,
        current: point.currentCumulativeCents,
      })),
    ).toEqual([
      { day: 1, date: "2026-08-01", current: 100 },
      { day: 2, date: "2026-08-02", current: 100 },
      { day: 3, date: "2026-08-03", current: 300 },
      { day: 4, date: "2026-08-04", current: 300 },
    ]);
  });

  it("UNIT-005 normalizes 28-, 30-, and 31-day history by day number and clamps shorter months", () => {
    const februaryClamp = model("2026-04-30T16:00:00.000Z", [
      transaction("jan-31", "2026-01-31", -3_100),
      transaction("feb-28", "2026-02-28", -2_800),
      transaction("mar-31", "2026-03-31", -3_100),
    ]);
    expect(februaryClamp.comparison.baselineMonthCount).toBe(3);
    expect(februaryClamp.comparison.points[28]).toMatchObject({
      day: 29,
      baselineAverageCents: 933,
    });
    expect(februaryClamp.comparison.points[29]).toMatchObject({
      day: 30,
      baselineAverageCents: 933,
    });

    const thirtyDayClamp = model("2026-07-31T16:00:00.000Z", [
      transaction("apr-30", "2026-04-30", -3_000),
      transaction("may-31", "2026-05-31", -3_100),
      transaction("jun-30", "2026-06-30", -3_000),
    ]);
    expect(thirtyDayClamp.comparison.points[30]).toMatchObject({
      day: 31,
      baselineAverageCents: 3_033,
    });
  });

  it("UNIT-006 averages only the one or two prior months that contain qualifying rows", () => {
    const oneMonth = model("2026-08-03T16:00:00.000Z", [
      transaction("july", "2026-07-02", -3_000),
    ]);
    expect(oneMonth.comparison.baselineMonthCount).toBe(1);
    expect(oneMonth.comparison.points[2]?.baselineAverageCents).toBe(3_000);

    const twoMonths = model("2026-08-03T16:00:00.000Z", [
      transaction("july", "2026-07-02", -3_000),
      transaction("june", "2026-06-03", -1_000),
    ]);
    expect(twoMonths.comparison.baselineMonthCount).toBe(2);
    expect(twoMonths.comparison.points[2]?.baselineAverageCents).toBe(2_000);
  });

  it("UNIT-007 reports zero history months and null baseline values when none qualify", () => {
    const overview = model("2026-08-03T16:00:00.000Z", [
      transaction("current", "2026-08-02", -3_000),
      transaction("old-income", "2026-07-02", 9_000, {
        kindOverride: "income",
      }),
      transaction("old-transfer", "2026-06-02", -9_000, {
        kindOverride: "transfer",
      }),
    ]);

    expect(overview.comparison.baselineMonthCount).toBe(0);
    expect(
      overview.comparison.points.every(
        (point) => point.baselineAverageCents === null,
      ),
    ).toBe(true);
  });

  it("UNIT-008 applies reconciliation and excludes transfers, income, excluded, removed, and superseded rows while netting refunds", () => {
    const overview = model("2026-08-12T16:00:00.000Z", [
      transaction("included", "2026-08-03", -3_000),
      transaction("refund", "2026-08-04", 500),
      transaction("transfer", "2026-08-05", -9_000, {
        kindOverride: "transfer",
      }),
      transaction("income", "2026-08-06", 10_000, {
        kindOverride: "income",
      }),
      transaction("excluded", "2026-08-07", -8_000, { excluded: true }),
      transaction("removed", "2026-08-08", -7_000, { removed: true }),
      transaction("pending-old", "2026-08-09", 4_000, {
        source: "plaid",
        kindOverride: null,
        pending: true,
        providerTransactionId: "provider-pending",
      }),
      transaction("posted-new", "2026-08-10", 4_000, {
        source: "plaid",
        kindOverride: null,
        pending: false,
        providerTransactionId: "provider-posted",
        pendingTransactionId: "provider-pending",
      }),
      transaction("prior-spend", "2026-07-03", -6_000),
      transaction("prior-refund", "2026-07-04", 1_000),
      transaction("prior-excluded", "2026-07-05", -8_000, {
        excluded: true,
      }),
    ]);

    expect(overview.budgetHealth.spentCents).toBe(6_500);
    expect(overview.comparison.baselineMonthCount).toBe(1);
    expect(overview.comparison.points.at(-1)).toMatchObject({
      currentCumulativeCents: 6_500,
      baselineAverageCents: 5_000,
    });
  });
});
