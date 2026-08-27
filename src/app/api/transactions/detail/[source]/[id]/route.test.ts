import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/transactions/transaction-detail", () => ({
  getTransactionDetailApiContext: vi.fn(),
  readTransactionDetail: vi.fn(),
  toTransactionDetailApiErrorResponse: vi.fn(),
}));

import {
  getTransactionDetailApiContext,
  readTransactionDetail,
  toTransactionDetailApiErrorResponse,
} from "@/lib/transactions/transaction-detail";
import { GET } from "./route";

const actor = {
  supabase: {},
  userId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000001",
};
const PLAID_ID = "40000000-0000-4000-8000-000000000001";
const MANUAL_ID = "50000000-0000-4000-8000-000000000001";

function request(source: string, id: string) {
  return GET(
    new Request(`http://localhost/api/transactions/detail/${source}/${id}`),
    {
      params: Promise.resolve({ source, id }),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTransactionDetailApiContext).mockResolvedValue(actor as never);
  vi.mocked(toTransactionDetailApiErrorResponse).mockImplementation((error) =>
    error instanceof Error && error.message === "forbidden"
      ? Response.json({ error: "Forbidden." }, { status: 403 })
      : Response.json({ error: "Transaction not found." }, { status: 404 }),
  );
});

describe("GH-66 source-aware transaction detail endpoint", () => {
  it("API-001 returns the complete authorized Plaid detail", async () => {
    const detail = {
      id: PLAID_ID,
      source: "plaid" as const,
      date: "2026-08-12",
      merchantOrDescription: "Green Market",
      description: "GREEN MARKET TORONTO",
      amountCents: -4275,
      accountName: "Household Chequing",
      scope: "family" as const,
      state: "pending" as const,
      kind: "spending" as const,
      originalCategory: {
        primary: "FOOD_AND_DRINK",
        detailed: "FOOD_AND_DRINK_GROCERIES",
      },
      effectiveCategory: "Groceries",
      excluded: false,
      notes: "Weekly food shop",
    };
    vi.mocked(readTransactionDetail).mockResolvedValue(detail);
    const response = await request("plaid", PLAID_ID);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ transaction: detail });
    expect(getTransactionDetailApiContext).toHaveBeenCalledOnce();
    expect(readTransactionDetail).toHaveBeenCalledExactlyOnceWith(
      actor,
      "plaid",
      PLAID_ID,
    );
  });

  it("API-002 returns complete manual detail with nullable provider fields and preserved notes", async () => {
    const detail = {
      id: MANUAL_ID,
      source: "manual" as const,
      date: "2026-08-11",
      merchantOrDescription: "Cash tutoring",
      description: "Cash tutoring",
      amountCents: 10000,
      accountName: null,
      scope: "personal" as const,
      state: "posted" as const,
      kind: "income" as const,
      originalCategory: null,
      effectiveCategory: "Other income",
      excluded: false,
      notes: "August lesson",
    };
    vi.mocked(readTransactionDetail).mockResolvedValue(detail);
    const response = await request("manual", MANUAL_ID);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ transaction: detail });
    expect(readTransactionDetail).toHaveBeenCalledExactlyOnceWith(
      actor,
      "manual",
      MANUAL_ID,
    );
  });

  it.each([
    ["bank", PLAID_ID],
    ["plaid", "not-a-uuid"],
    ["manual", "40000000-0000-0000-0000-000000000001"],
  ])(
    "API-003 rejects unsupported source or malformed UUID before querying (%s/%s)",
    async (source, id) => {
      const response = await request(source, id);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid request." });
      expect(getTransactionDetailApiContext).not.toHaveBeenCalled();
      expect(readTransactionDetail).not.toHaveBeenCalled();
    },
  );

  it("API-004 preserves one sanitized not-found response for absent or unauthorized rows", async () => {
    vi.mocked(readTransactionDetail).mockRejectedValue(
      new Error("database row is absent or hidden by RLS"),
    );
    const response = await request("plaid", PLAID_ID);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ error: "Transaction not found." });
    expect(JSON.stringify(body)).not.toMatch(/workspace|owner|scope|rls/i);
    expect(toTransactionDetailApiErrorResponse).toHaveBeenCalledOnce();
  });

  it("API-005 preserves the sanitized membership-auth response and never reads a row", async () => {
    vi.mocked(getTransactionDetailApiContext).mockRejectedValue(
      new Error("forbidden"),
    );
    const response = await request("manual", MANUAL_ID);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden." });
    expect(readTransactionDetail).not.toHaveBeenCalled();
    expect(toTransactionDetailApiErrorResponse).toHaveBeenCalledOnce();
  });
});
