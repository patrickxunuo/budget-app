import { describe, expect, it } from "vitest";
import type { DashboardTransaction } from "./types";
import {
  aggregateDashboard,
  aggregateMonthlyBudgetTargets,
  cadToCents,
  getDateRange,
  inclusionMatches,
  moveReference,
} from "./domain";
describe("dashboard domain", () => {
  it("uses integer cents", () => expect(cadToCents("12.34")).toBe(1234));
  it("moves weeks by seven days", () =>
    expect(moveReference("2026-08-12", "week", -1)).toBe("2026-08-05"));
  it("moves month-end references into the adjacent calendar month", () =>
    expect(moveReference("2026-08-31", "month", 1)).toBe("2026-09-01"));
  it("keeps excluded rows out of default", () =>
    expect(
      inclusionMatches(
        {
          id: "x",
          source: "manual",
          scope: "family",
          accountId: null,
          accountName: null,
          merchantOrDescription: "x",
          category: null,
          amountCents: 1,
          date: "2026-08-12",
          pending: false,
          kind: "spending",
          excluded: true,
        },
        "default",
      ),
    ).toBe(false));
  it("does not count a hidden pending transfer as pending cash flow", () => {
    const transfer = {
      id: "transfer",
      source: "plaid" as const,
      scope: "family" as const,
      accountId: "account",
      accountName: "Chequing",
      merchantOrDescription: "Card payment",
      category: null,
      amountCents: 5000,
      date: "2026-08-12",
      pending: true,
      kind: "transfer" as const,
      excluded: false,
    };
    const model = aggregateDashboard({
      scope: "family",
      period: "day",
      range: { startDate: "2026-08-12", endDate: "2026-08-12" },
      timeZone: "America/Toronto",
      rows: [],
      aggregateRows: [transfer],
      categories: [],
      budgets: [],
      accounts: [],
      limit: 50,
    });
    expect(model.summary).toMatchObject({
      pendingAmountCents: 0,
      pendingCount: 0,
    });
  });
  it("counts one recurring target for every calendar month touched", () => {
    const totals = aggregateMonthlyBudgetTargets(
      [
        {
          categoryId: "food",
          amountCents: 40000,
          effectiveMonth: "2026-07-01",
          endMonth: null,
        },
      ],
      { startDate: "2026-07-20", endDate: "2026-08-08" },
    );
    expect(totals.get("food")).toBe(80000);
  });

  it("uses exactly one effective version per category and month", () => {
    const totals = aggregateMonthlyBudgetTargets(
      [
        {
          categoryId: "food",
          amountCents: 40000,
          effectiveMonth: "2026-07-01",
          endMonth: "2026-07-01",
        },
        {
          categoryId: "food",
          amountCents: 50000,
          effectiveMonth: "2026-08-01",
          endMonth: null,
        },
      ],
      { startDate: "2026-07-01", endDate: "2026-08-31" },
    );
    expect(totals.get("food")).toBe(90000);
  });

  it("counts a recurring target once inside a single month", () => {
    const totals = aggregateMonthlyBudgetTargets(
      [
        {
          categoryId: "food",
          amountCents: 40000,
          effectiveMonth: "2026-01-01",
          endMonth: null,
        },
      ],
      { startDate: "2026-08-12", endDate: "2026-08-18" },
    );
    expect(totals.get("food")).toBe(40000);
  });
});

// GH-14 F6: the ledger is displayed in the workspace's Canadian accounting
// zone (src/lib/dashboard/service.ts pins America/Toronto), so every range
// edge is a *local* edge. A UTC-shaped boundary silently moves a member's
// evening spending into the next day, and a DST day is 23 or 25 hours long.
const TIME_ZONE = "America/Toronto";

function dashboardRow(
  overrides: Partial<DashboardTransaction> & { id: string; date: string },
): DashboardTransaction {
  return {
    source: "plaid",
    scope: "family",
    accountId: "account",
    accountName: "Chequing",
    merchantOrDescription: "Northern Grocer",
    category: null,
    amountCents: 2000,
    pending: false,
    kind: "spending",
    excluded: false,
    ...overrides,
  };
}

function model(
  range: { startDate: string; endDate: string },
  rows: DashboardTransaction[],
) {
  return aggregateDashboard({
    scope: "family",
    period: "day",
    range,
    timeZone: TIME_ZONE,
    rows: [],
    aggregateRows: rows,
    categories: [],
    budgets: [],
    accounts: [],
    limit: 50,
  });
}

describe("GH-14 local-timezone range boundaries (F6)", () => {
  it("DASH-001 keeps a 23:59:59 local transaction inside its own day", () => {
    // 03:59:59Z is 23:59:59 EDT on the previous local day; one second later is
    // midnight on the next one.
    expect(
      getDateRange("day", new Date("2026-08-13T03:59:59.000Z"), TIME_ZONE),
    ).toEqual({ startDate: "2026-08-12", endDate: "2026-08-12" });
    expect(
      getDateRange("day", new Date("2026-08-13T04:00:00.000Z"), TIME_ZONE),
    ).toEqual({ startDate: "2026-08-13", endDate: "2026-08-13" });
  });

  it("DASH-002 counts the last local second of a range and drops the first of the next", () => {
    const range = getDateRange(
      "day",
      new Date("2026-08-13T03:59:59.000Z"),
      TIME_ZONE,
    );
    const summary = model(range, [
      dashboardRow({
        id: "last-second",
        date: "2026-08-12",
        amountCents: 2000,
      }),
      dashboardRow({ id: "next-day", date: "2026-08-13", amountCents: 9900 }),
    ]);

    expect(summary.summary.spendingCents).toBe(2000);
    expect(summary.summary.includedCount).toBe(1);
    expect(summary.trend).toEqual([
      { date: "2026-08-12", incomeCents: 0, spendingCents: 2000 },
    ]);
  });

  it("DASH-003 starts the week at local Monday midnight, not UTC Monday", () => {
    expect(
      getDateRange("week", new Date("2026-08-10T03:59:59.000Z"), TIME_ZONE),
    ).toEqual({ startDate: "2026-08-03", endDate: "2026-08-09" });
    expect(
      getDateRange("week", new Date("2026-08-10T04:00:00.000Z"), TIME_ZONE),
    ).toEqual({ startDate: "2026-08-10", endDate: "2026-08-16" });
  });

  it("DASH-004 rolls the month at local midnight, not UTC midnight", () => {
    expect(
      getDateRange("month", new Date("2026-09-01T03:59:59.000Z"), TIME_ZONE),
    ).toEqual({ startDate: "2026-08-01", endDate: "2026-08-31" });
    expect(
      getDateRange("month", new Date("2026-09-01T04:00:00.000Z"), TIME_ZONE),
    ).toEqual({ startDate: "2026-09-01", endDate: "2026-09-30" });
  });

  it("DASH-005 keeps the 23-hour spring-forward day a single local day", () => {
    // 2026-03-08 in Toronto skips 02:00-02:59: 01:59:59 EST is followed by
    // 03:00:00 EDT. Both instants belong to the same local day.
    expect(
      getDateRange("day", new Date("2026-03-08T04:59:59.000Z"), TIME_ZONE),
    ).toEqual({ startDate: "2026-03-07", endDate: "2026-03-07" });
    expect(
      getDateRange("day", new Date("2026-03-08T06:59:59.000Z"), TIME_ZONE),
    ).toEqual({ startDate: "2026-03-08", endDate: "2026-03-08" });
    expect(
      getDateRange("day", new Date("2026-03-08T07:00:00.000Z"), TIME_ZONE),
    ).toEqual({ startDate: "2026-03-08", endDate: "2026-03-08" });
    expect(
      getDateRange("week", new Date("2026-03-08T07:00:00.000Z"), TIME_ZONE),
    ).toEqual({ startDate: "2026-03-02", endDate: "2026-03-08" });
  });

  it("DASH-006 keeps the 25-hour fall-back day a single local day", () => {
    // 2026-11-01 in Toronto repeats 01:00-01:59: 01:30 EDT and 01:30 EST are
    // an hour apart and must not land on different days or be double-counted.
    for (const instant of [
      "2026-11-01T05:30:00.000Z",
      "2026-11-01T06:30:00.000Z",
    ]) {
      expect(getDateRange("day", new Date(instant), TIME_ZONE)).toEqual({
        startDate: "2026-11-01",
        endDate: "2026-11-01",
      });
    }
    expect(
      getDateRange("day", new Date("2026-11-02T04:59:59.000Z"), TIME_ZONE),
    ).toEqual({ startDate: "2026-11-01", endDate: "2026-11-01" });
    expect(
      getDateRange("day", new Date("2026-11-02T05:00:00.000Z"), TIME_ZONE),
    ).toEqual({ startDate: "2026-11-02", endDate: "2026-11-02" });
    expect(
      getDateRange("week", new Date("2026-11-02T04:59:59.000Z"), TIME_ZONE),
    ).toEqual({ startDate: "2026-10-26", endDate: "2026-11-01" });
  });

  it("DASH-007 aggregates both halves of a repeated local hour into one day", () => {
    const range = getDateRange(
      "day",
      new Date("2026-11-01T06:30:00.000Z"),
      TIME_ZONE,
    );
    const summary = model(range, [
      dashboardRow({ id: "edt-half", date: "2026-11-01", amountCents: 1500 }),
      dashboardRow({ id: "est-half", date: "2026-11-01", amountCents: 2500 }),
      dashboardRow({ id: "next-day", date: "2026-11-02", amountCents: 9900 }),
    ]);

    expect(summary.summary.spendingCents).toBe(4000);
    expect(summary.summary.includedCount).toBe(2);
    expect(summary.trend).toEqual([
      { date: "2026-11-01", incomeCents: 0, spendingCents: 4000 },
    ]);
  });

  it("DASH-008 moves the reference by whole calendar steps across a DST change", () => {
    expect(moveReference("2026-03-07", "day", 1)).toBe("2026-03-08");
    expect(moveReference("2026-03-08", "day", 1)).toBe("2026-03-09");
    expect(moveReference("2026-03-01", "week", 1)).toBe("2026-03-08");
    expect(moveReference("2026-11-01", "day", 1)).toBe("2026-11-02");
    expect(moveReference("2026-10-25", "week", 1)).toBe("2026-11-01");
    expect(moveReference("2026-03-08", "month", 1)).toBe("2026-04-01");
  });

  it("DASH-009 expands a monthly target once for a DST day inside one month", () => {
    const totals = aggregateMonthlyBudgetTargets(
      [
        {
          categoryId: "food",
          amountCents: 40000,
          effectiveMonth: "2026-01-01",
          endMonth: null,
        },
      ],
      getDateRange("day", new Date("2026-03-08T07:00:00.000Z"), TIME_ZONE),
    );

    expect(totals.get("food")).toBe(40000);
  });
});

describe("GH-65 complete-set aggregation", () => {
  const rows = Array.from({ length: 61 }, (_, index) =>
    dashboardRow({
      id: `row-${String(index).padStart(3, "0")}`,
      date: `2026-08-${String(31 - (index % 31)).padStart(2, "0")}`,
      amountCents: 100,
    }),
  );

  it("API-001 keeps complete accounting totals and count independent of a 50-row page", () => {
    const result = aggregateDashboard({
      scope: "family",
      period: "month",
      range: { startDate: "2026-08-01", endDate: "2026-08-31" },
      timeZone: TIME_ZONE,
      rows,
      aggregateRows: rows,
      categories: [],
      budgets: [],
      accounts: [],
      limit: 50,
      totalTransactionCount: rows.length,
      nextCursor: "opaque-next-page",
    });

    expect(result.transactions).toHaveLength(50);
    expect(result.totalTransactionCount).toBe(61);
    expect(result.nextCursor).toBe("opaque-next-page");
    expect(result.summary).toMatchObject({
      spendingCents: 6100,
      includedCount: 61,
    });
  });

  it("API-006 preserves complete unlimited output for CSV-style callers", () => {
    const result = aggregateDashboard({
      scope: "family",
      period: "month",
      range: { startDate: "2026-08-01", endDate: "2026-08-31" },
      timeZone: TIME_ZONE,
      rows,
      aggregateRows: rows,
      categories: [],
      budgets: [],
      accounts: [],
      limit: Number.MAX_SAFE_INTEGER,
      totalTransactionCount: rows.length,
      nextCursor: null,
    });

    expect(result.transactions.map(({ id }) => id)).toEqual(
      rows.map(({ id }) => id),
    );
    expect(result.totalTransactionCount).toBe(rows.length);
    expect(result.nextCursor).toBeNull();
  });
});
