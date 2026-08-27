import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CategoryServiceError } from "@/lib/categories/service";
import {
  readTransactionDetail,
  toTransactionDetailApiErrorResponse,
} from "./transaction-detail";

const userId = "10000000-0000-4000-8000-000000000001";
const workspaceId = "20000000-0000-4000-8000-000000000001";
const plaidId = "40000000-0000-4000-8000-000000000001";
const manualId = "50000000-0000-4000-8000-000000000001";
type Table = "transactions" | "manual_entries";
type Call = { table: Table; method: string; args: unknown[] };
type Fixture = {
  rows?: Partial<Record<Table, unknown>>;
  errors?: Partial<Record<Table, unknown>>;
};

function supabaseFixture(fixture: Fixture = {}) {
  const calls: Call[] = [];

  function query(table: Table) {
    const chain = {
      select(...args: unknown[]) {
        calls.push({ table, method: "select", args });
        return chain;
      },
      eq(...args: unknown[]) {
        calls.push({ table, method: "eq", args });
        return chain;
      },
      is(...args: unknown[]) {
        calls.push({ table, method: "is", args });
        return chain;
      },
      maybeSingle() {
        calls.push({ table, method: "maybeSingle", args: [] });
        return Promise.resolve({
          data: fixture.rows?.[table] ?? null,
          error: fixture.errors?.[table] ?? null,
        });
      },
    };
    return chain;
  }

  return {
    client: { from: vi.fn((table: Table) => query(table)) },
    calls,
  };
}

function context(fixture: ReturnType<typeof supabaseFixture>) {
  return { supabase: fixture.client, userId, workspaceId } as never;
}

function expectConstrainedQuery(
  fixture: ReturnType<typeof supabaseFixture>,
  table: Table,
  id: string,
  deletedColumn: "removed_at" | "deleted_at",
) {
  expect(fixture.client.from).toHaveBeenCalledExactlyOnceWith(table);
  expect(fixture.calls).toEqual(
    expect.arrayContaining([
      { table, method: "eq", args: ["id", id] },
      { table, method: "eq", args: ["workspace_id", workspaceId] },
      { table, method: "is", args: [deletedColumn, null] },
      { table, method: "maybeSingle", args: [] },
    ]),
  );
}

async function responseBody(error: unknown) {
  const response = toTransactionDetailApiErrorResponse(error);
  return { response, body: await response.json() };
}

describe("GH-66 transaction detail service boundary", () => {
  it("SERVICE-001 maps the authorized Plaid row, provider/effective categories, note, account, and provider-sign spending", async () => {
    const fixture = supabaseFixture({
      rows: {
        transactions: {
          id: plaidId,
          amount: 42.75,
          transaction_date: "2026-08-12",
          merchant_name: "Green Market",
          name: "GREEN MARKET TORONTO",
          pending: true,
          provider_payload: {
            personalFinanceCategory: {
              primary: "FOOD_AND_DRINK",
              detailed: "FOOD_AND_DRINK_GROCERIES",
            },
            access_token: "must-never-leave-the-service",
          },
          accounts: {
            name: "Chequing",
            display_name: "Household Chequing",
            scope: "family",
          },
          transaction_metadata: {
            kind_override: null,
            note: "Weekly food shop",
            excluded: false,
            categories: { id: "category-1", name: "Groceries" },
          },
        },
      },
    });

    const result = await readTransactionDetail(
      context(fixture),
      "plaid",
      plaidId,
    );

    expect(result).toEqual({
      id: plaidId,
      source: "plaid",
      date: "2026-08-12",
      merchantOrDescription: "Green Market",
      description: "GREEN MARKET TORONTO",
      amountCents: -4275,
      accountName: "Household Chequing",
      scope: "family",
      state: "pending",
      kind: "spending",
      originalCategory: {
        primary: "FOOD_AND_DRINK",
        detailed: "FOOD_AND_DRINK_GROCERIES",
      },
      effectiveCategory: "Groceries",
      excluded: false,
      notes: "Weekly food shop",
    });
    expect(JSON.stringify(result)).not.toMatch(/access_token|workspace|owner/i);
    expectConstrainedQuery(fixture, "transactions", plaidId, "removed_at");
  });

  it("SERVICE-002 maps the authorized Manual row with null provider fields, retained notes, and signed income", async () => {
    const fixture = supabaseFixture({
      rows: {
        manual_entries: {
          id: manualId,
          scope: "personal",
          kind: "income",
          amount: "100.00",
          entry_date: "2026-08-11",
          description: "Cash tutoring",
          notes: "August lesson",
          category_id: "category-2",
          deleted_at: null,
          categories: { id: "category-2", name: "Other income" },
        },
      },
    });

    const result = await readTransactionDetail(
      context(fixture),
      "manual",
      manualId,
    );

    expect(result).toEqual({
      id: manualId,
      source: "manual",
      date: "2026-08-11",
      merchantOrDescription: "Cash tutoring",
      description: "Cash tutoring",
      amountCents: 10000,
      accountName: null,
      scope: "personal",
      state: "posted",
      kind: "income",
      originalCategory: null,
      effectiveCategory: "Other income",
      excluded: false,
      notes: "August lesson",
    });
    expectConstrainedQuery(fixture, "manual_entries", manualId, "deleted_at");
  });

  it.each([
    ["plaid" as const, "transactions" as const, plaidId, "removed_at" as const],
    [
      "manual" as const,
      "manual_entries" as const,
      manualId,
      "deleted_at" as const,
    ],
  ])(
    "SERVICE-003 treats an absent or RLS-hidden %s row as the same sanitized 404",
    async (source, table, id, deletedColumn) => {
      const fixture = supabaseFixture({ rows: { [table]: null } });

      let thrown: unknown;
      try {
        await readTransactionDetail(context(fixture), source, id);
      } catch (error) {
        thrown = error;
      }

      const { response, body } = await responseBody(thrown);
      expect(response.status).toBe(404);
      expect(body).toEqual({ error: "Transaction not found." });
      expect(JSON.stringify(body)).not.toMatch(
        /workspace|owner|scope|rls|table/i,
      );
      expectConstrainedQuery(fixture, table, id, deletedColumn);
    },
  );

  it.each([
    ["plaid" as const, "transactions" as const, plaidId],
    ["manual" as const, "manual_entries" as const, manualId],
  ])(
    "SERVICE-004 sanitizes a %s database failure as a retryable 500",
    async (source, table, id) => {
      const fixture = supabaseFixture({
        errors: {
          [table]: { code: "XX001", message: "private database detail" },
        },
      });

      let thrown: unknown;
      try {
        await readTransactionDetail(context(fixture), source, id);
      } catch (error) {
        thrown = error;
      }

      const { response, body } = await responseBody(thrown);
      expect(response.status).toBe(500);
      expect(body).toEqual({
        error: "Transaction details are temporarily unavailable.",
      });
      expect(JSON.stringify(body)).not.toMatch(
        /XX001|private database detail/i,
      );
    },
  );

  it.each([
    [401, "Sign in to continue."],
    [403, "An active workspace membership is required."],
  ])(
    "SERVICE-005 maps membership/auth status %i without leaking its internal reason",
    async (status, expected) => {
      const { response, body } = await responseBody(
        new CategoryServiceError(status, "internal auth context detail"),
      );
      expect(response.status).toBe(status);
      expect(body).toEqual({ error: expected });
      expect(JSON.stringify(body)).not.toContain(
        "internal auth context detail",
      );
    },
  );
});
