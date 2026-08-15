import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  readDashboardOverview,
  toDashboardOverviewApiErrorResponse,
} from "./overview-service";

const userId = "10000000-0000-4000-8000-000000000001";
const workspaceId = "20000000-0000-4000-8000-000000000001";

type Table =
  "accounts" | "categories" | "budgets" | "transactions" | "manual_entries";
type Call = { table: Table; method: string; args: unknown[] };
type Fixture = {
  rows?: Partial<Record<Table, unknown[]>>;
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
          data: (fixture.rows?.[table] ?? []).slice(from, to + 1),
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

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: "account-1",
    name: "Chequing",
    display_name: "Household Chequing",
    mask: "1234",
    subtype: "chequing",
    available_balance_cents: 192_500,
    current_balance_cents: 200_000,
    balance_updated_at: "2026-08-12T12:00:00.000Z",
    ...overrides,
  };
}

describe("GH-31 dashboard overview service boundary", () => {
  it("SERVICE-001 applies the Family privacy boundary to every financial source and reads only the current plus three prior months", async () => {
    const fixture = supabaseFixture({ rows: { accounts: [account()] } });

    const overview = await readDashboardOverview(
      context(fixture),
      "family",
      "2026-08-12T16:00:00.000Z",
    );

    expect(overview).toMatchObject({
      scope: "family",
      asOfDate: "2026-08-12",
      range: { startDate: "2026-08-01", endDate: "2026-08-12" },
    });
    for (const table of [
      "accounts",
      "categories",
      "budgets",
      "manual_entries",
    ] as const) {
      expect(fixture.calls).toContainEqual({
        table,
        method: "eq",
        args: ["scope", "family"],
      });
      expect(fixture.calls).toContainEqual({
        table,
        method: "is",
        args: ["owner_profile_id", null],
      });
    }
    expect(fixture.calls).toEqual(
      expect.arrayContaining([
        {
          table: "transactions",
          method: "eq",
          args: ["accounts.scope", "family"],
        },
        {
          table: "transactions",
          method: "is",
          args: ["accounts.owner_profile_id", null],
        },
        {
          table: "transactions",
          method: "gte",
          args: ["transaction_date", "2026-05-01"],
        },
        {
          table: "transactions",
          method: "lte",
          args: ["transaction_date", "2026-08-12"],
        },
        {
          table: "manual_entries",
          method: "gte",
          args: ["entry_date", "2026-05-01"],
        },
        {
          table: "manual_entries",
          method: "lte",
          args: ["entry_date", "2026-08-12"],
        },
      ]),
    );
    expect(
      fixture.calls.some(
        (call) =>
          call.method === "eq" &&
          call.args[0] === "owner_profile_id" &&
          call.args[1] === userId,
      ),
    ).toBe(false);
  });

  it("SERVICE-002 binds every Personal query to the signed-in profile while reading only shared system-category definitions", async () => {
    const fixture = supabaseFixture();

    const overview = await readDashboardOverview(
      context(fixture),
      "personal",
      "2026-08-12T16:00:00.000Z",
    );

    expect(overview.scope).toBe("personal");
    for (const table of [
      "accounts",
      "categories",
      "budgets",
      "manual_entries",
    ] as const) {
      expect(fixture.calls).toContainEqual({
        table,
        method: "eq",
        args: ["scope", "personal"],
      });
      expect(fixture.calls).toContainEqual({
        table,
        method: "eq",
        args: ["owner_profile_id", userId],
      });
    }
    expect(fixture.calls).toEqual(
      expect.arrayContaining([
        {
          table: "transactions",
          method: "eq",
          args: ["accounts.scope", "personal"],
        },
        {
          table: "transactions",
          method: "eq",
          args: ["accounts.owner_profile_id", userId],
        },
        { table: "categories", method: "eq", args: ["scope", "family"] },
        {
          table: "categories",
          method: "is",
          args: ["owner_profile_id", null],
        },
        {
          table: "categories",
          method: "not",
          args: ["system_key", "is", null],
        },
      ]),
    );
  });

  it("SERVICE-003 preserves nullable account balances and freshness instead of fabricating zeroes", async () => {
    const fixture = supabaseFixture({
      rows: {
        accounts: [
          account({
            id: "account-null",
            display_name: null,
            name: "Credit account",
            mask: null,
            subtype: "credit_card",
            available_balance_cents: null,
            current_balance_cents: null,
            balance_updated_at: null,
          }),
        ],
      },
    });

    const overview = await readDashboardOverview(
      context(fixture),
      "family",
      "2026-08-12T16:00:00.000Z",
    );

    expect(overview.accounts).toEqual([
      {
        id: "account-null",
        name: "Credit account",
        mask: null,
        subtype: "credit_card",
        availableCents: null,
        currentCents: null,
        freshnessAt: null,
      },
    ]);
  });

  it("SERVICE-004 converts provider and invalid-financial-value failures into a sanitized dashboard response", async () => {
    const providerFailure = supabaseFixture({
      errors: {
        transactions: {
          message: "relation ledger failed; password=secret",
          details: "private row contents",
        },
      },
    });

    let caught: unknown;
    try {
      await readDashboardOverview(
        context(providerFailure),
        "family",
        "2026-08-12T16:00:00.000Z",
      );
    } catch (error) {
      caught = error;
    }
    const providerResponse = toDashboardOverviewApiErrorResponse(caught);
    expect(providerResponse.status).toBe(500);
    expect(await providerResponse.json()).toEqual({
      error: "Dashboard unavailable.",
    });

    const unsafeBalance = supabaseFixture({
      rows: {
        accounts: [account({ available_balance_cents: "9007199254740992" })],
      },
    });
    let unsafeCaught: unknown;
    try {
      await readDashboardOverview(
        context(unsafeBalance),
        "family",
        "2026-08-12T16:00:00.000Z",
      );
    } catch (error) {
      unsafeCaught = error;
    }
    const unsafeResponse = toDashboardOverviewApiErrorResponse(unsafeCaught);
    expect(unsafeResponse.status).toBe(500);
    const unsafeBody = await unsafeResponse.json();
    expect(unsafeBody).toMatchObject({ error: "Dashboard unavailable." });
    expect(JSON.stringify(unsafeBody)).not.toMatch(
      /ledger|password|secret|private row|900719/i,
    );
  });
});
