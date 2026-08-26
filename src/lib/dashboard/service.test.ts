import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DashboardServiceError,
  readDashboard,
  toDashboardApiErrorResponse,
} from "./service";

const userId = "10000000-0000-4000-8000-000000000001";
const workspaceId = "20000000-0000-4000-8000-000000000001";
const accountId = "30000000-0000-4000-8000-000000000001";
const categoryId = "40000000-0000-4000-8000-000000000001";

type Table =
  "accounts" | "categories" | "budgets" | "transactions" | "manual_entries";
type Call = { table: Table; method: string; args: unknown[] };
type Rows = Partial<Record<Table, unknown[]>>;

function supabaseFixture(rows: Rows) {
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
      not(...args: unknown[]) {
        calls.push({ table, method: "not", args });
        return chain;
      },
      lte(...args: unknown[]) {
        calls.push({ table, method: "lte", args });
        return chain;
      },
      gte(...args: unknown[]) {
        calls.push({ table, method: "gte", args });
        return chain;
      },
      or(...args: unknown[]) {
        calls.push({ table, method: "or", args });
        return chain;
      },
      order(...args: unknown[]) {
        calls.push({ table, method: "order", args });
        return chain;
      },
      range(from: number, to: number) {
        calls.push({ table, method: "range", args: [from, to] });
        return Promise.resolve({
          data: (rows[table] ?? []).slice(from, to + 1),
          error: null,
        });
      },
    };
    return chain;
  }

  return {
    rows,
    client: { from: vi.fn((table: Table) => query(table)) },
    calls,
  };
}

function accountRow() {
  return {
    id: accountId,
    name: "Chequing",
    display_name: "Household Chequing",
    mask: "1234",
    subtype: "chequing",
    available_balance_cents: 100_000,
    current_balance_cents: 100_000,
    balance_updated_at: "2026-08-26T12:00:00.000Z",
    scope: "family",
    owner_profile_id: null,
  };
}

function plaidRow(index: number) {
  return {
    id: `p-${String(index).padStart(3, "0")}`,
    account_id: accountId,
    plaid_transaction_id: `provider-${index}`,
    amount: 1,
    transaction_date: index < 20 ? "2026-08-26" : "2026-08-25",
    merchant_name: index % 9 === 0 ? "Needle Market" : "Grocer",
    name: "Purchase",
    pending: false,
    pending_transaction_id: null,
    provider_payload: null,
    accounts: accountRow(),
    transaction_metadata: {
      kind_override: index === 0 ? "transfer" : null,
      note: null,
      excluded: index === 1,
      categories: {
        id: categoryId,
        name: "Groceries",
        color: "#18745b",
      },
    },
  };
}

function manualRow(index: number) {
  return {
    id: `m-${String(index).padStart(3, "0")}`,
    scope: "family",
    owner_profile_id: null,
    kind: "spending",
    amount: "-1.00",
    entry_date: index < 10 ? "2026-08-26" : "2026-08-25",
    description: index % 7 === 0 ? "Needle cash" : "Cash purchase",
    notes: null,
    category_id: categoryId,
    deleted_at: null,
    categories: {
      id: categoryId,
      name: "Groceries",
      color: "#18745b",
    },
  };
}

function financialFixture() {
  return supabaseFixture({
    accounts: [accountRow()],
    categories: [
      {
        id: categoryId,
        name: "Groceries",
        color: "#18745b",
        system_key: null,
        scope: "family",
        owner_profile_id: null,
      },
    ],
    budgets: [],
    transactions: Array.from({ length: 31 }, (_, index) => plaidRow(index)),
    manual_entries: Array.from({ length: 30 }, (_, index) => manualRow(index)),
  });
}

function context(fixture: ReturnType<typeof financialFixture>) {
  return {
    supabase: fixture.client,
    userId,
    workspaceId,
  } as never;
}

function query(overrides: Record<string, string> = {}) {
  return {
    scope: "family",
    period: "month",
    reference: "2026-08-26",
    status: "all",
    inclusion: "all",
    limit: "13",
    ...overrides,
  };
}

describe("GH-65 dashboard service cursor pagination", () => {
  it("API-001 API-002 API-003 traverses every mixed-source row exactly once with complete totals on every page", async () => {
    const fixture = financialFixture();
    const pages: Awaited<ReturnType<typeof readDashboard>>[] = [];
    let cursor: string | null = null;

    do {
      const page = await readDashboard(context(fixture), {
        ...query(),
        ...(cursor ? { cursor } : {}),
      });
      pages.push(page);
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(pages.map((page) => page.transactions.length)).toEqual([
      13, 13, 13, 13, 9,
    ]);
    expect(pages.at(-1)?.nextCursor).toBeNull();
    for (const page of pages) {
      expect(page.totalTransactionCount).toBe(61);
      expect(page.summary).toMatchObject({
        spendingCents: 5900,
        includedCount: 59,
        excludedCount: 1,
      });
    }

    const traversed = pages.flatMap((page) => page.transactions);
    const keys = traversed.map(({ source, id }) => `${source}:${id}`);
    expect(keys).toHaveLength(61);
    expect(new Set(keys).size).toBe(61);

    const expected = [
      ...Array.from(
        { length: 10 },
        (_, index) => `manual:m-${String(index).padStart(3, "0")}`,
      ),
      ...Array.from(
        { length: 20 },
        (_, index) => `plaid:p-${String(index).padStart(3, "0")}`,
      ),
      ...Array.from(
        { length: 20 },
        (_, offset) => `manual:m-${String(offset + 10).padStart(3, "0")}`,
      ),
      ...Array.from(
        { length: 11 },
        (_, offset) => `plaid:p-${String(offset + 20).padStart(3, "0")}`,
      ),
    ];
    expect(keys).toEqual(expected);
    expect(pages.slice(0, -1).every((page) => page.nextCursor !== null)).toBe(
      true,
    );
  });

  it("API-004 computes count and complete totals after search/status/category filters but before cursor slicing", async () => {
    const fixture = financialFixture();
    const first = await readDashboard(
      context(fixture),
      query({
        search: "needle",
        categoryId,
        status: "posted",
        limit: "3",
      }),
    );

    // Plaid indexes 0/9/18/27 plus Manual indexes 0/7/14/21/28.
    expect(first.totalTransactionCount).toBe(9);
    expect(first.transactions).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    expect(first.summary).toMatchObject({
      spendingCents: 800,
      includedCount: 8,
      excludedCount: 0,
    });

    const second = await readDashboard(context(fixture), {
      ...query({
        search: "needle",
        categoryId,
        status: "posted",
        limit: "3",
      }),
      cursor: first.nextCursor!,
    });
    expect(second.totalTransactionCount).toBe(9);
    expect(second.summary).toEqual(first.summary);
  });

  it("API-005 exposes a sanitized 400 cursor field error without querying financial tables", async () => {
    const fixture = financialFixture();
    let caught: unknown;
    try {
      await readDashboard(context(fixture), query({ cursor: "not-json" }));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DashboardServiceError);
    expect(caught).toMatchObject({
      status: 400,
      message: "Invalid request.",
      fields: { cursor: ["Use a cursor returned by this endpoint."] },
    });
    expect(fixture.client.from).not.toHaveBeenCalled();
    const response = toDashboardApiErrorResponse(caught);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid request.",
      fields: { cursor: ["Use a cursor returned by this endpoint."] },
    });
  });

  it("API-006 unlimited output preserves all complete-set rows and ignores cursor/limit slicing", async () => {
    const fixture = financialFixture();
    const firstPage = await readDashboard(
      context(fixture),
      query({ limit: "5" }),
    );
    const unlimited = await readDashboard(
      context(fixture),
      {
        ...query({ limit: "1" }),
        cursor: firstPage.nextCursor!,
      },
      { unlimited: true },
    );

    expect(unlimited.transactions).toHaveLength(61);
    expect(unlimited.totalTransactionCount).toBe(61);
    expect(unlimited.nextCursor).toBeNull();
    expect(unlimited.summary).toMatchObject({
      spendingCents: 5900,
      includedCount: 59,
      excludedCount: 1,
    });
  });

  it("API-007 continues after a removed boundary row without restarting or duplicating", async () => {
    const fixture = financialFixture();
    const first = await readDashboard(context(fixture), query({ limit: "13" }));
    const boundary = first.transactions.at(-1)!;
    expect(boundary).toMatchObject({ source: "plaid", id: "p-002" });

    fixture.rows.transactions = (fixture.rows.transactions ?? []).filter(
      (candidate) => (candidate as { id: string }).id !== boundary.id,
    );
    const second = await readDashboard(context(fixture), {
      ...query({ limit: "13" }),
      cursor: first.nextCursor!,
    });

    const firstKeys = first.transactions.map(
      ({ source, id }) => `${source}:${id}`,
    );
    const secondKeys = second.transactions.map(
      ({ source, id }) => `${source}:${id}`,
    );
    expect(secondKeys[0]).toBe("plaid:p-003");
    expect(secondKeys).not.toContain("plaid:p-002");
    expect(secondKeys.some((key) => firstKeys.includes(key))).toBe(false);
    expect(second.totalTransactionCount).toBe(60);
  });
});
