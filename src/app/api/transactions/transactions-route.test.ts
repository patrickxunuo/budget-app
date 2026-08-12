import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/categories/service", () => ({
  getApiContext: vi.fn(),
  listTransactions: vi.fn(),
  toApiErrorResponse: vi.fn(() =>
    Response.json({ error: "Invalid request." }, { status: 400 }),
  ),
}));
vi.mock("@/lib/manual-entries/service", () => ({ listManualEntries: vi.fn() }));

import { getApiContext, listTransactions } from "@/lib/categories/service";
import { listManualEntries } from "@/lib/manual-entries/service";
import { GET } from "./route";

const actor = {
  supabase: {},
  userId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000001",
};
const accountId = "30000000-0000-4000-8000-000000000001";
const categoryId = "30000000-0000-4000-8000-000000000002";
const plaidSpending = {
  id: "40000000-0000-4000-8000-000000000001",
  scope: "family" as const,
  ownerProfileId: null,
  merchantName: "Green Market",
  name: "GREEN MARKET",
  amount: 42.75,
  transactionDate: "2026-08-11",
  pending: true,
  kindOverride: null,
  excluded: false,
  originalPlaidCategory: {
    primary: "FOOD_AND_DRINK",
    detailed: "FOOD_AND_DRINK_GROCERIES",
  },
  effectiveCategory: {
    id: categoryId,
    name: "Groceries",
    color: "#18745b",
    source: "plaid" as const,
    updatedBy: null,
    updatedAt: null,
  },
  stableMerchantId: "entity-grocer",
  normalizedMerchant: "green market",
};
const plaidRefund = {
  ...plaidSpending,
  id: "40000000-0000-4000-8000-000000000002",
  merchantName: "Green Market Refund",
  amount: -5,
  pending: false,
  kindOverride: "refund" as const,
};
const manualIncome = {
  id: "50000000-0000-4000-8000-000000000001",
  source: "manual" as const,
  scope: "family" as const,
  ownerProfileId: null,
  kind: "income" as const,
  amount: "100.00",
  currencyCode: "CAD" as const,
  entryDate: "2026-08-12",
  description: "Cash tutoring",
  categoryId: null,
  notes: null,
  createdBy: actor.userId,
  lastEditedBy: actor.userId,
  createdAt: "2026-08-12T12:00:00.000Z",
  updatedAt: "2026-08-12T12:00:00.000Z",
  deletedAt: null,
  deletedBy: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getApiContext).mockResolvedValue(actor as never);
  vi.mocked(listTransactions).mockResolvedValue([
    plaidSpending,
    plaidRefund,
  ] as never);
  vi.mocked(listManualEntries).mockResolvedValue([manualIncome] as never);
});

describe("GH-9 extended transactions endpoint", () => {
  it("API-010 applies shared filters, limits display rows, and calculates the complete Plaid/manual summary", async () => {
    const response = await GET(
      new Request(
        `http://localhost/api/transactions?scope=family&from=2026-08-01&to=2026-08-31&accountId=${accountId}&categoryId=${categoryId}&status=all&inclusion=default&search=green&limit=1`,
      ),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.transactions).toEqual([]);
    expect(body.manualEntries).toEqual([manualIncome]);
    expect(body.summary).toMatchObject({
      incomeCents: 10000,
      spendingCents: 3775,
      refundsCents: 500,
      netFlowCents: 6225,
    });
    expect(listTransactions).toHaveBeenCalledExactlyOnceWith(
      actor,
      undefined,
      undefined,
      expect.objectContaining({
        scope: "family",
        accountId,
        categoryId,
        status: "all",
        inclusion: "default",
        search: "green",
      }),
    );
    expect(listManualEntries).toHaveBeenCalledExactlyOnceWith(
      actor,
      expect.objectContaining({
        scope: "family",
        categoryId,
        search: "green",
      }),
    );
  });
});
