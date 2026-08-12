import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/categories/service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/categories/service")>();
  return { ...actual, listTransactions: vi.fn() };
});
vi.mock("@/lib/manual-entries/service", () => ({ listManualEntries: vi.fn() }));

import { listTransactions } from "@/lib/categories/service";
import { listManualEntries } from "@/lib/manual-entries/service";
import {
  BudgetServiceError,
  createBudget,
  inspectBudgetHistory,
  readBudgetMonth,
  updateBudget,
} from "./service";

const workspaceId = "ca200000-0000-4000-8000-000000000001";
const userId = "ca100000-0000-4000-8000-000000000001";
const groceryId = "ca300000-0000-4000-8000-000000000001";
const budgetId = "ca400000-0000-4000-8000-000000000001";
type Fixture = {
  budgets?: unknown[];
  categories?: unknown[];
  singleBudgets?: Record<string, unknown>;
  errors?: Partial<Record<"budgets" | "categories", { code?: string }>>;
  rpcResults?: Array<{ data: unknown; error: { code?: string } | null }>;
};
type Call = { table: string; method: string; args: unknown[] };

function supabaseFixture(fixture: Fixture) {
  const calls: Call[] = [];
  const rpcResults = [...(fixture.rpcResults ?? [])];
  function query(table: "budgets" | "categories") {
    let selectedId: string | undefined;
    const chain = {
      select(...args: unknown[]) {
        calls.push({ table, method: "select", args });
        return chain;
      },
      eq(...args: unknown[]) {
        calls.push({ table, method: "eq", args });
        if (args[0] === "id") selectedId = String(args[1]);
        return chain;
      },
      is(...args: unknown[]) {
        calls.push({ table, method: "is", args });
        return chain;
      },
      lte(...args: unknown[]) {
        calls.push({ table, method: "lte", args });
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
          data: (fixture[table] ?? []).slice(from, to + 1),
          error: fixture.errors?.[table] ?? null,
        });
      },
      maybeSingle() {
        calls.push({ table, method: "maybeSingle", args: [] });
        return Promise.resolve({
          data: selectedId
            ? (fixture.singleBudgets?.[selectedId] ?? null)
            : null,
          error: fixture.errors?.[table] ?? null,
        });
      },
      then(
        resolve: (result: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) {
        return Promise.resolve({
          data: fixture[table] ?? [],
          error: fixture.errors?.[table] ?? null,
        }).then(resolve, reject);
      },
    };
    return chain;
  }
  return {
    client: {
      from: vi.fn((table: "budgets" | "categories") => query(table)),
      rpc: vi.fn((name: string, args: unknown) => {
        calls.push({ table: "rpc", method: name, args: [args] });
        return Promise.resolve(
          rpcResults.shift() ?? { data: null, error: null },
        );
      }),
    },
    calls,
  };
}

function budgetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: budgetId,
    category_id: groceryId,
    amount_cents: 50000,
    currency_code: "CAD",
    effective_month: "2026-08-01",
    end_month: null,
    scope: "family",
    owner_profile_id: null,
    archived_at: null,
    categories: { name: "Groceries", color: "#18745b" },
    ...overrides,
  };
}
function plaid(overrides: Record<string, unknown>) {
  return {
    id: "plaid",
    scope: "family" as const,
    ownerProfileId: null,
    merchantName: "Merchant",
    name: "Merchant",
    amount: 1,
    transactionDate: "2026-08-10",
    pending: false,
    kindOverride: null,
    excluded: false,
    originalPlaidCategory: {
      primary: "FOOD_AND_DRINK",
      detailed: "FOOD_AND_DRINK_GROCERIES",
    },
    effectiveCategory: {
      id: groceryId,
      name: "Groceries",
      color: "#18745b",
      source: "manual" as const,
      updatedBy: userId,
      updatedAt: "2026-08-10T12:00:00Z",
    },
    stableMerchantId: null,
    normalizedMerchant: "merchant",
    ...overrides,
  };
}
function manual(kind: "spending" | "refund", amount: string) {
  return {
    id: "manual-" + kind,
    source: "manual" as const,
    scope: "family" as const,
    ownerProfileId: null,
    kind,
    amount,
    currencyCode: "CAD" as const,
    entryDate: "2026-08-12",
    description: kind,
    categoryId: groceryId,
    categoryName: "Groceries",
    notes: null,
    createdBy: userId,
    lastEditedBy: userId,
    createdAt: "2026-08-12T12:00:00Z",
    updatedAt: "2026-08-12T12:00:00Z",
    deletedAt: null,
    deletedBy: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listTransactions).mockResolvedValue([]);
  vi.mocked(listManualEntries).mockResolvedValue([]);
});

describe("GH-10 budget service integration boundary", () => {
  it("API-001/API-002 pages complete scoped rows and applies explicit Family/Personal owner filters", async () => {
    const categories = Array.from({ length: 1001 }, (_, index) => ({
      id: "category-" + index,
      name: "Category " + index,
      color: null,
    }));
    const family = supabaseFixture({
      budgets: [budgetRow()],
      categories: [
        { id: groceryId, name: "Groceries", color: "#18745b" },
        ...categories,
      ],
    });
    const model = await readBudgetMonth(
      { supabase: family.client, userId, workspaceId } as never,
      "family",
      "2026-08-01",
    );
    expect(model.budgets).toHaveLength(1);
    expect(model.availableCategories).toHaveLength(1001);
    expect(family.calls).toEqual(
      expect.arrayContaining([
        { table: "budgets", method: "eq", args: ["scope", "family"] },
        { table: "budgets", method: "is", args: ["owner_profile_id", null] },
        { table: "categories", method: "range", args: [1000, 1999] },
      ]),
    );
    expect(listTransactions).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      undefined,
      { scope: "family", from: "2026-08-01", to: "2026-08-31" },
    );

    const personal = supabaseFixture({ budgets: [], categories: [] });
    await readBudgetMonth(
      { supabase: personal.client, userId, workspaceId } as never,
      "personal",
      "2026-08-01",
    );
    expect(personal.calls).toEqual(
      expect.arrayContaining([
        { table: "budgets", method: "eq", args: ["scope", "personal"] },
        { table: "budgets", method: "eq", args: ["owner_profile_id", userId] },
        {
          table: "categories",
          method: "eq",
          args: ["owner_profile_id", userId],
        },
      ]),
    );
  });

  it("API-003 createBudget calls the exact RPC and refreshes the returned row", async () => {
    const created = budgetRow({ id: "ca400000-0000-4000-8000-000000000020" });
    const fixture = supabaseFixture({
      singleBudgets: { [String(created.id)]: created },
      rpcResults: [{ data: { id: created.id }, error: null }],
    });
    const context = { supabase: fixture.client, userId, workspaceId } as never;
    await expect(
      createBudget(context, {
        scope: "family",
        categoryId: groceryId,
        amountCents: 50000,
        effectiveMonth: "2026-08-01",
      }),
    ).resolves.toMatchObject({ id: created.id, amountCents: 50000 });
    expect(fixture.calls).toContainEqual({
      table: "rpc",
      method: "create_budget_target",
      args: [
        {
          p_scope: "family",
          p_category_id: groceryId,
          p_amount_cents: 50000,
          p_effective_month: "2026-08-01",
        },
      ],
    });
    expect(fixture.calls).toContainEqual({
      table: "budgets",
      method: "maybeSingle",
      args: [],
    });
  });

  it("API-005/API-006 updateBudget selects revise/archive RPC arguments and refreshes the new row", async () => {
    const revised = budgetRow({
      id: "ca400000-0000-4000-8000-000000000021",
      amount_cents: 60000,
      effective_month: "2026-09-01",
    });
    const archived = budgetRow({
      id: "ca400000-0000-4000-8000-000000000022",
      end_month: "2026-09-01",
      archived_at: "2026-10-01T00:00:00Z",
    });
    const fixture = supabaseFixture({
      singleBudgets: {
        [String(revised.id)]: revised,
        [String(archived.id)]: archived,
      },
      rpcResults: [
        { data: { id: revised.id }, error: null },
        { data: { id: archived.id }, error: null },
      ],
    });
    const context = { supabase: fixture.client, userId, workspaceId } as never;
    await expect(
      updateBudget(context, budgetId, {
        amountCents: 60000,
        effectiveMonth: "2026-09-01",
      }),
    ).resolves.toMatchObject({ id: revised.id, amountCents: 60000 });
    await expect(
      updateBudget(context, revised.id, {
        archived: true,
        effectiveMonth: "2026-10-01",
      }),
    ).resolves.toMatchObject({ id: archived.id, archived: true });
    expect(fixture.calls).toEqual(
      expect.arrayContaining([
        {
          table: "rpc",
          method: "revise_budget_target",
          args: [
            {
              p_id: budgetId,
              p_amount_cents: 60000,
              p_effective_month: "2026-09-01",
            },
          ],
        },
        {
          table: "rpc",
          method: "archive_budget_target",
          args: [
            {
              p_id: revised.id,
              p_effective_month: "2026-10-01",
            },
          ],
        },
      ]),
    );
  });

  it("maps RPC conflicts/domain errors and distinguishes null create/update results", async () => {
    const conflict = supabaseFixture({
      rpcResults: [{ data: null, error: { code: "23505" } }],
    });
    await expect(
      createBudget(
        { supabase: conflict.client, userId, workspaceId } as never,
        {
          scope: "family",
          categoryId: groceryId,
          amountCents: 1,
          effectiveMonth: "2026-08-01",
        },
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: "A target already applies to this category and month.",
    });

    const domain = supabaseFixture({
      rpcResults: [{ data: null, error: { code: "23503" } }],
    });
    await expect(
      createBudget({ supabase: domain.client, userId, workspaceId } as never, {
        scope: "family",
        categoryId: groceryId,
        amountCents: 1,
        effectiveMonth: "2026-08-01",
      }),
    ).rejects.toMatchObject({
      status: 400,
      fields: {
        categoryId: ["Choose an active category in the same privacy scope."],
      },
    });

    const nullCreate = supabaseFixture({
      rpcResults: [{ data: null, error: null }],
    });
    await expect(
      createBudget(
        { supabase: nullCreate.client, userId, workspaceId } as never,
        {
          scope: "family",
          categoryId: groceryId,
          amountCents: 1,
          effectiveMonth: "2026-08-01",
        },
      ),
    ).rejects.toMatchObject({ status: 500, message: "Budgets unavailable." });

    const nullUpdate = supabaseFixture({
      rpcResults: [{ data: null, error: null }],
    });
    await expect(
      updateBudget(
        { supabase: nullUpdate.client, userId, workspaceId } as never,
        budgetId,
        { archived: true, effectiveMonth: "2026-09-01" },
      ),
    ).rejects.toMatchObject({
      status: 404,
      message: "Budget target not found.",
    });
  });
  it("API-007 aggregates pending spending, omits excluded/transfers, and nets refunds", async () => {
    const fixture = supabaseFixture({
      budgets: [budgetRow({ amount_cents: 20000 })],
      categories: [{ id: groceryId, name: "Groceries", color: "#18745b" }],
    });
    vi.mocked(listTransactions).mockResolvedValue([
      plaid({ id: "pending", amount: 100, pending: true }),
      plaid({ id: "excluded", amount: 90, excluded: true }),
      plaid({
        id: "transfer",
        amount: 80,
        originalPlaidCategory: {
          primary: "TRANSFER_OUT",
          detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
        },
      }),
    ] as never);
    vi.mocked(listManualEntries).mockResolvedValue([
      manual("spending", "-25.00"),
      manual("refund", "10.00"),
    ] as never);
    const model = await readBudgetMonth(
      { supabase: fixture.client, userId, workspaceId } as never,
      "family",
      "2026-08-01",
    );
    expect(model.budgets[0]).toMatchObject({
      spentCents: 11500,
      remainingCents: 8500,
      overBudgetCents: 0,
      status: "on-track",
    });
    expect(model.budgets[0]?.percentageUsed).toBeCloseTo(57.5, 8);
    expect(model.summary).toEqual({
      targetCents: 20000,
      spentCents: 11500,
      remainingCents: 8500,
      overBudgetCents: 0,
    });
  });

  it("API-007 clamps negative net category spending progress to zero", async () => {
    const fixture = supabaseFixture({
      budgets: [budgetRow({ amount_cents: 10000 })],
      categories: [],
    });
    vi.mocked(listManualEntries).mockResolvedValue([
      manual("refund", "25.00"),
    ] as never);
    const model = await readBudgetMonth(
      { supabase: fixture.client, userId, workspaceId } as never,
      "family",
      "2026-08-01",
    );
    expect(model.budgets[0]).toMatchObject({
      spentCents: -2500,
      remainingCents: 12500,
      percentageUsed: 0,
      status: "on-track",
    });
  });

  it("API-009 keeps archived-category versions inspectable and ordered", async () => {
    const old = budgetRow({
      id: "ca400000-0000-4000-8000-000000000010",
      amount_cents: 40000,
      effective_month: "2026-07-01",
      end_month: "2026-08-01",
      categories: { name: "Archived groceries", color: null },
    });
    const archived = budgetRow({
      id: budgetId,
      amount_cents: 50000,
      effective_month: "2026-09-01",
      end_month: "2026-09-01",
      archived_at: "2026-10-01T00:00:00Z",
      categories: { name: "Archived groceries", color: null },
    });
    const fixture = supabaseFixture({
      budgets: [old, archived],
      singleBudgets: { [budgetId]: archived },
    });
    const result = await inspectBudgetHistory(
      { supabase: fixture.client, userId, workspaceId } as never,
      budgetId,
      "2026-08-01",
    );
    expect(result.budget).toMatchObject({
      id: old.id,
      amountCents: 40000,
      categoryName: "Archived groceries",
    });
    expect(result.history.map((row) => row.id)).toEqual([old.id, budgetId]);
    expect(result.history[1]).toMatchObject({
      archived: true,
      endMonth: "2026-09-01",
    });
  });

  it("rejects unsafe persisted cents and maps database privacy errors without leakage", async () => {
    const unsafe = supabaseFixture({
      budgets: [budgetRow({ amount_cents: "9007199254740992" })],
      categories: [],
    });
    await expect(
      readBudgetMonth(
        { supabase: unsafe.client, userId, workspaceId } as never,
        "family",
        "2026-08-01",
      ),
    ).rejects.toMatchObject({ status: 500, message: "Budgets unavailable." });

    const denied = supabaseFixture({
      budgets: [],
      categories: [],
      errors: { budgets: { code: "42501" } },
    });
    await expect(
      readBudgetMonth(
        { supabase: denied.client, userId, workspaceId } as never,
        "personal",
        "2026-08-01",
      ),
    ).rejects.toEqual(
      new BudgetServiceError(403, "An active family membership is required."),
    );
  });
});
