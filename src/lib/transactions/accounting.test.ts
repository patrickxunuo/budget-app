import { describe, expect, it } from "vitest";

import {
  calculateSummary,
  classifyTransaction,
  formatLocalDate,
  getDateRange,
  normalizeCashFlowCents,
  reconcilePendingTransactions,
  resolveAccountingLine,
  type AccountingTransaction,
} from "./accounting";

function transaction(
  overrides: Partial<AccountingTransaction> = {},
): AccountingTransaction {
  return {
    id: "transaction-1",
    source: "plaid",
    amountCents: 1_000,
    currencyCode: "CAD",
    date: "2026-08-12",
    name: "Test transaction",
    ...overrides,
  };
}

describe("transaction accounting", () => {
  it("DOM-001 normalizes Plaid debit/credit and manual signed amounts", () => {
    expect(normalizeCashFlowCents(transaction({ amountCents: 1_250 }))).toBe(
      -1_250,
    );
    expect(normalizeCashFlowCents(transaction({ amountCents: -2_500 }))).toBe(
      2_500,
    );
    expect(
      normalizeCashFlowCents(
        transaction({ source: "manual", amountCents: 3_000 }),
      ),
    ).toBe(3_000);
    expect(
      normalizeCashFlowCents(
        transaction({ source: "manual", amountCents: -750 }),
      ),
    ).toBe(-750);
  });

  it("DOM-002 classifies salary, interest, deposits, and purchases and totals them", () => {
    const transactions = [
      transaction({
        id: "salary",
        amountCents: -100_000,
        providerCategoryPrimary: "INCOME",
        providerCategoryDetailed: "INCOME_WAGES",
      }),
      transaction({
        id: "interest",
        amountCents: -500,
        providerCategoryPrimary: "INCOME",
        providerCategoryDetailed: "INCOME_INTEREST_EARNED",
      }),
      transaction({
        id: "deposit",
        amountCents: -2_000,
        providerCategoryPrimary: "TRANSFER_IN",
        providerCategoryDetailed: "TRANSFER_IN_DEPOSIT",
      }),
      transaction({
        id: "purchase",
        amountCents: 4_250,
        providerCategoryPrimary: "GENERAL_MERCHANDISE",
      }),
    ];

    expect(transactions.map(classifyTransaction)).toEqual([
      "income",
      "income",
      "income",
      "spending",
    ]);
    expect(calculateSummary(transactions)).toMatchObject({
      incomeCents: 102_500,
      spendingCents: 4_250,
      refundsCents: 0,
      netFlowCents: 98_250,
      includedCount: 4,
    });
  });

  it("DOM-003 keeps transfers and credit-card payments visible without inflating ordinary totals", () => {
    const transactions = [
      transaction({
        id: "transfer",
        amountCents: 10_000,
        providerCategoryPrimary: "TRANSFER_OUT",
      }),
      transaction({
        id: "card-payment",
        amountCents: 7_500,
        providerCategoryDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
      }),
    ];

    expect(reconcilePendingTransactions(transactions)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "transfer", inclusion: "transfer" }),
        expect.objectContaining({
          id: "card-payment",
          inclusion: "transfer",
        }),
      ]),
    );
    expect(calculateSummary(transactions)).toMatchObject({
      incomeCents: 0,
      spendingCents: 0,
      refundsCents: 0,
      netFlowCents: 0,
      transferCents: 17_500,
      includedCount: 0,
      excludedCount: 0,
    });
  });

  it("DOM-004 applies refunds and reversals against spending and category spending", () => {
    const transactions = [
      transaction({
        id: "purchase",
        amountCents: 5_000,
        categoryId: "groceries",
      }),
      transaction({
        id: "refund",
        amountCents: -1_200,
        categoryId: "groceries",
        providerCategoryPrimary: "GENERAL_MERCHANDISE",
        providerCategoryDetailed: "GENERAL_MERCHANDISE_REFUND",
      }),
      transaction({
        id: "reversal",
        amountCents: -300,
        categoryId: "groceries",
        providerCategoryPrimary: "GENERAL_MERCHANDISE",
        providerCategoryDetailed: "GENERAL_MERCHANDISE_REVERSAL",
        name: "Purchase reversal",
      }),
    ];

    expect(transactions.slice(1).map(classifyTransaction)).toEqual([
      "refund",
      "refund",
    ]);
    expect(calculateSummary(transactions)).toMatchObject({
      incomeCents: 0,
      spendingCents: 3_500,
      refundsCents: 1_500,
      netFlowCents: -3_500,
      categorySpendingCents: { groceries: 3_500 },
    });
  });

  it("DOM-002 limits interest and deposit income classification to explicit provider categories", () => {
    const bankFeeInterest = transaction({
      id: "bank-fee-interest",
      amountCents: 1_500,
      providerCategoryPrimary: "BANK_FEES",
      providerCategoryDetailed: "BANK_FEES_INTEREST_CHARGE",
    });
    const unrelatedDeposit = transaction({
      id: "security-deposit-fee",
      amountCents: 2_000,
      providerCategoryPrimary: "RENT_AND_UTILITIES",
      providerCategoryDetailed: "RENT_AND_UTILITIES_SECURITY_DEPOSIT",
    });
    const incomeInterest = transaction({
      id: "income-interest",
      amountCents: -250,
      providerCategoryPrimary: "INCOME",
      providerCategoryDetailed: "INCOME_INTEREST_EARNED",
    });
    const genuineDeposit = transaction({
      id: "cash-deposit",
      amountCents: -3_000,
      providerCategoryPrimary: "TRANSFER_IN",
      providerCategoryDetailed: "TRANSFER_IN_DEPOSIT",
    });

    expect(
      [bankFeeInterest, unrelatedDeposit, incomeInterest, genuineDeposit].map(
        classifyTransaction,
      ),
    ).toEqual(["spending", "spending", "income", "income"]);
  });

  it("DOM-003 gives transfer categories precedence over refund-like display names", () => {
    const transactions = [
      transaction({
        id: "refund-named-transfer",
        amountCents: 10_000,
        providerCategoryPrimary: "TRANSFER_OUT",
        name: "Refundable savings transfer",
      }),
      transaction({
        id: "reversal-named-card-payment",
        amountCents: 7_500,
        providerCategoryDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
        name: "Reversal plan fee payment",
      }),
    ];

    expect(transactions.map(classifyTransaction)).toEqual([
      "transfer",
      "transfer",
    ]);
    expect(reconcilePendingTransactions(transactions)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "refund-named-transfer",
          inclusion: "transfer",
        }),
        expect.objectContaining({
          id: "reversal-named-card-payment",
          inclusion: "transfer",
        }),
      ]),
    );
  });

  it("DOM-004 ignores refund-like words in arbitrary names but honors explicit refund and reversal details", () => {
    const transactions = [
      transaction({
        id: "refundable-deposit-fee",
        amountCents: 800,
        name: "Refundable deposit fee",
      }),
      transaction({
        id: "reversal-plan-fee",
        amountCents: 900,
        name: "Reversal plan fee",
      }),
      transaction({
        id: "explicit-refund",
        amountCents: -500,
        providerCategoryPrimary: "GENERAL_MERCHANDISE",
        providerCategoryDetailed: "GENERAL_MERCHANDISE_REFUND",
        name: "Merchant credit",
      }),
      transaction({
        id: "explicit-reversal",
        amountCents: -300,
        providerCategoryPrimary: "GENERAL_MERCHANDISE",
        providerCategoryDetailed: "GENERAL_MERCHANDISE_REVERSAL",
        name: "Corrected purchase",
      }),
    ];

    expect(transactions.map(classifyTransaction)).toEqual([
      "spending",
      "spending",
      "refund",
      "refund",
    ]);
    expect(calculateSummary(transactions)).toMatchObject({
      incomeCents: 0,
      spendingCents: 900,
      refundsCents: 800,
      netFlowCents: -900,
    });
    expect(
      classifyTransaction(
        transaction({
          id: "explicit-bank-fee-refund",
          amountCents: 100,
          providerCategoryPrimary: "BANK_FEES",
          providerCategoryDetailed: "BANK_FEES_REFUND",
        }),
      ),
    ).toBe("refund");
  });

  it.each([
    ["pending first", ["pending", "posted"]],
    ["posted first", ["posted", "pending"]],
  ])(
    "DOM-005 supersedes a pending predecessor when the posted replacement is %s",
    (_description, order) => {
      const byId: Record<string, AccountingTransaction> = {
        pending: transaction({
          id: "pending",
          providerTransactionId: "provider-pending",
          amountCents: 2_000,
          pending: true,
        }),
        posted: transaction({
          id: "posted",
          providerTransactionId: "provider-posted",
          pendingTransactionId: "provider-pending",
          amountCents: 2_000,
          pending: false,
        }),
      };
      const input = order.map((id) => byId[id]!);
      const lines = reconcilePendingTransactions(input);

      expect(lines.find((line) => line.id === "pending")?.inclusion).toBe(
        "superseded",
      );
      expect(lines.find((line) => line.id === "posted")?.inclusion).toBe(
        "included",
      );
      expect(calculateSummary(input)).toMatchObject({
        spendingCents: 2_000,
        pendingCount: 0,
        includedCount: 1,
      });
    },
  );

  it("DOM-006 includes unreconciled pending activity and counts it", () => {
    const pending = transaction({
      id: "unreconciled",
      providerTransactionId: "provider-unreconciled",
      amountCents: 1_875,
      pending: true,
    });

    expect(resolveAccountingLine(pending)).toMatchObject({
      inclusion: "included",
      pending: true,
    });
    expect(calculateSummary([pending])).toMatchObject({
      spendingCents: 1_875,
      pendingCount: 1,
      includedCount: 1,
    });
  });

  it("DOM-007 honors kind overrides and exclusion without mutating source facts", () => {
    const overridden = transaction({
      id: "overridden",
      amountCents: 900,
      providerCategoryPrimary: "TRANSFER_OUT",
      kindOverride: "spending",
    });
    const excluded = transaction({
      id: "excluded",
      amountCents: -5_000,
      providerCategoryPrimary: "INCOME",
      kindOverride: "income",
      excluded: true,
      pending: true,
    });
    const before = structuredClone([overridden, excluded]);

    expect(resolveAccountingLine(overridden)).toMatchObject({
      kind: "spending",
      inclusion: "included",
    });
    expect(resolveAccountingLine(excluded)).toMatchObject({
      kind: "income",
      inclusion: "excluded",
    });
    expect(calculateSummary([overridden, excluded])).toMatchObject({
      incomeCents: 0,
      spendingCents: 900,
      pendingCount: 0,
      includedCount: 1,
      excludedCount: 1,
    });
    expect([overridden, excluded]).toEqual(before);
  });

  it("DOM-008 rejects non-CAD and unsafe, non-integer cent values", () => {
    expect(() =>
      calculateSummary([transaction({ currencyCode: "USD" })]),
    ).toThrow();
    expect(() =>
      normalizeCashFlowCents(transaction({ amountCents: 10.5 })),
    ).toThrow();
    expect(() =>
      normalizeCashFlowCents(
        transaction({ amountCents: Number.MAX_SAFE_INTEGER + 1 }),
      ),
    ).toThrow();
    expect(() =>
      normalizeCashFlowCents(transaction({ amountCents: Number.NaN })),
    ).toThrow();
  });

  it("DOM-009 calculates inclusive Canadian local day, Monday week, and month boundaries", () => {
    const boundaryInstant = new Date("2026-03-08T07:30:00.000Z");
    expect(formatLocalDate(boundaryInstant, "America/Vancouver")).toBe(
      "2026-03-07",
    );
    expect(formatLocalDate(boundaryInstant, "America/Toronto")).toBe(
      "2026-03-08",
    );
    expect(
      getDateRange(
        "week",
        new Date("2026-03-11T03:30:00.000Z"),
        "America/Vancouver",
      ),
    ).toEqual({ startDate: "2026-03-09", endDate: "2026-03-15" });
    expect(
      getDateRange(
        "month",
        new Date("2026-11-01T03:30:00.000Z"),
        "America/Toronto",
      ),
    ).toEqual({ startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(
      getDateRange(
        "day",
        new Date("2026-11-01T03:30:00.000Z"),
        "America/Toronto",
      ),
    ).toEqual({ startDate: "2026-10-31", endDate: "2026-10-31" });

    expect(() =>
      getDateRange("day", new Date(), "Not/A_Canadian_Timezone"),
    ).toThrow();
    expect(() =>
      getDateRange("custom", new Date(), "America/Vancouver", {
        startDate: "2026-03-02",
        endDate: "2026-03-01",
      }),
    ).toThrow();
    expect(() =>
      getDateRange("custom", new Date(), "America/Vancouver", {
        startDate: "2026-02-30",
        endDate: "2026-03-01",
      }),
    ).toThrow();
    expect(() =>
      getDateRange("quarter" as never, new Date(), "America/Vancouver"),
    ).toThrow();
  });

  it("DOM-010 filters an inclusive custom range and aggregates net category spending", () => {
    const transactions = [
      transaction({
        id: "range-start",
        amountCents: 2_000,
        date: "2026-08-01",
        categoryId: "food",
      }),
      transaction({
        id: "refund",
        amountCents: -500,
        date: "2026-08-15",
        categoryId: "food",
        providerCategoryDetailed: "GENERAL_MERCHANDISE_REFUND",
      }),
      transaction({
        id: "range-end",
        amountCents: 300,
        date: "2026-08-31",
        categoryId: "transport",
      }),
      transaction({
        id: "outside",
        amountCents: 99_999,
        date: "2026-09-01",
        categoryId: "food",
      }),
      transaction({
        id: "removed",
        amountCents: 50_000,
        date: "2026-08-10",
        categoryId: "food",
        removed: true,
      }),
    ];

    expect(
      calculateSummary(transactions, {
        startDate: "2026-08-01",
        endDate: "2026-08-31",
      }),
    ).toMatchObject({
      spendingCents: 1_800,
      refundsCents: 500,
      netFlowCents: -1_800,
      includedCount: 3,
      categorySpendingCents: { food: 1_500, transport: 300 },
    });
  });
});
