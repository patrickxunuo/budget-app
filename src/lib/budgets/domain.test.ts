import { describe, expect, it } from "vitest";
import { budgetStatus, calculateBudgetProgress, moveMonth } from "./domain";
const target = {
  id: "b",
  categoryId: "c",
  categoryName: "Food",
  categoryColor: null,
  scope: "family" as const,
  amountCents: 10000,
  currencyCode: "CAD" as const,
  effectiveMonth: "2026-08-01",
  endMonth: null,
  archived: false,
};
describe("budget domain", () => {
  it.each([
    [7499, "on-track"],
    [7500, "watch"],
    [8999, "watch"],
    [9000, "close"],
    [9999, "close"],
    [10000, "at-limit"],
    [10001, "over"],
  ] as const)("maps %s cents to %s", (spent, status) =>
    expect(calculateBudgetProgress(target, spent).status).toBe(status),
  );
  it("nets negative spending to zero percent without rollover", () =>
    expect(calculateBudgetProgress(target, -500)).toMatchObject({
      percentageUsed: 0,
      remainingCents: 10500,
      overBudgetCents: 0,
    }));
  it("moves local calendar months", () => {
    expect(moveMonth("2026-01-01", -1)).toBe("2025-12-01");
    expect(moveMonth("2026-12-01", 1)).toBe("2027-01-01");
  });
  it("keeps exact threshold semantics", () =>
    expect(budgetStatus(100)).toBe("at-limit"));
});
