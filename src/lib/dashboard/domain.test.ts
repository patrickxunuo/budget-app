import { describe, expect, it } from "vitest";
import {
  aggregateDashboard,
  cadToCents,
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
});
