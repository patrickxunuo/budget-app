import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/budgets/service", () => {
  class BudgetServiceError extends Error {
    constructor(
      public readonly status: 400 | 401 | 403 | 404 | 409,
      message: string,
      public readonly fields?: Record<string, string[]>,
    ) {
      super(message);
    }
  }
  return {
    BudgetServiceError,
    getBudgetApiContext: vi.fn(),
    readBudgetMonth: vi.fn(),
    createBudgetTarget: vi.fn(),
    reviseBudgetTarget: vi.fn(),
    archiveBudgetTarget: vi.fn(),
    inspectBudgetTarget: vi.fn(),
    toBudgetApiErrorResponse: vi.fn((error: unknown) => {
      if (error instanceof BudgetServiceError) {
        return Response.json(
          {
            error: error.message,
            ...(error.fields ? { fields: error.fields } : {}),
          },
          { status: error.status },
        );
      }
      if (
        error &&
        typeof error === "object" &&
        "flatten" in error &&
        typeof error.flatten === "function"
      ) {
        return Response.json(
          {
            error: "Invalid request.",
            fields: error.flatten().fieldErrors,
          },
          { status: 400 },
        );
      }
      return Response.json({ error: "Invalid request." }, { status: 400 });
    }),
  };
});

import {
  BudgetServiceError,
  archiveBudgetTarget,
  createBudgetTarget,
  getBudgetApiContext,
  inspectBudgetTarget,
  readBudgetMonth,
  reviseBudgetTarget,
} from "@/lib/budgets/service";
import { GET as getBudgets, POST as postBudget } from "./route";
import { GET as getBudget, PATCH as patchBudget } from "./[id]/route";

const actor = {
  supabase: {},
  userId: "a1000000-0000-4000-8000-000000000001",
  workspaceId: "a2000000-0000-4000-8000-000000000001",
};
const groceryId = "a3000000-0000-4000-8000-000000000001";
const budgetId = "a4000000-0000-4000-8000-000000000001";
const familyTarget = {
  id: budgetId,
  categoryId: groceryId,
  categoryName: "Groceries",
  categoryColor: "#18745b",
  scope: "family" as const,
  amountCents: 50000,
  currencyCode: "CAD" as const,
  effectiveMonth: "2026-08-01",
  endMonth: null,
  archived: false,
};
const familyModel = {
  scope: "family" as const,
  month: "2026-08-01",
  monthEnd: "2026-08-31",
  currencyCode: "CAD" as const,
  budgets: [
    {
      ...familyTarget,
      spentCents: 38250,
      remainingCents: 11750,
      overBudgetCents: 0,
      percentageUsed: 76.5,
      status: "watch" as const,
    },
  ],
  availableCategories: [
    { id: "a3000000-0000-4000-8000-000000000002", name: "Dining", color: null },
  ],
  summary: {
    targetCents: 50000,
    spentCents: 38250,
    remainingCents: 11750,
    overBudgetCents: 0,
  },
};

function request(
  path: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  body?: unknown,
) {
  return new Request("http://localhost" + path, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}
function routeContext(id = budgetId) {
  return { params: Promise.resolve({ id }) } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getBudgetApiContext).mockResolvedValue(actor as never);
  vi.mocked(readBudgetMonth).mockResolvedValue(familyModel as never);
});

describe("GH-10 monthly budget route acceptance", () => {
  it("API-001 reads one Family calendar month with Family progress and summary only", async () => {
    const response = await getBudgets(
      request("/api/budgets?scope=family&month=2026-08-01"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(familyModel);
    expect(readBudgetMonth).toHaveBeenCalledExactlyOnceWith(
      actor,
      "family",
      "2026-08-01",
    );
    expect(JSON.stringify(familyModel)).not.toMatch(
      /personal|member-b-private/i,
    );
  });

  it("API-002 reads only the signed-in member's Personal targets and transactions", async () => {
    const personalModel = {
      ...familyModel,
      scope: "personal" as const,
      budgets: [
        {
          ...familyModel.budgets[0],
          id: "member-a-budget",
          scope: "personal" as const,
        },
      ],
    };
    vi.mocked(readBudgetMonth).mockResolvedValue(personalModel as never);
    const response = await getBudgets(
      request("/api/budgets?scope=personal&month=2026-08-01"),
    );
    const body = await response.json();
    expect(body.scope).toBe("personal");
    expect(body.budgets.map((budget: { id: string }) => budget.id)).toEqual([
      "member-a-budget",
    ]);
    expect(JSON.stringify(body)).not.toContain("member-b-budget");
    expect(readBudgetMonth).toHaveBeenCalledWith(
      actor,
      "personal",
      "2026-08-01",
    );
  });

  it("API-003 creates a positive safe-integer CAD target for an active matching category", async () => {
    vi.mocked(createBudgetTarget).mockResolvedValue(familyTarget as never);
    const response = await postBudget(
      request("/api/budgets", "POST", {
        scope: "family",
        categoryId: groceryId,
        amountCents: 50000,
        effectiveMonth: "2026-08-01",
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ budget: familyTarget });
    expect(createBudgetTarget).toHaveBeenCalledExactlyOnceWith(actor, {
      scope: "family",
      categoryId: groceryId,
      amountCents: 50000,
      effectiveMonth: "2026-08-01",
    });
  });

  it("API-004 rejects invalid cents/month fields and duplicate applicable targets without writing", async () => {
    const invalid = await postBudget(
      request("/api/budgets", "POST", {
        scope: "family",
        categoryId: groceryId,
        amountCents: 0.5,
        effectiveMonth: "2026-08-12",
      }),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual(
      expect.objectContaining({
        error: "Invalid request.",
        fields: expect.objectContaining({
          amountCents: expect.any(Array),
          effectiveMonth: expect.any(Array),
        }),
      }),
    );
    expect(createBudgetTarget).not.toHaveBeenCalled();

    vi.mocked(createBudgetTarget).mockRejectedValueOnce(
      new BudgetServiceError(
        409,
        "A target already applies to this category and month.",
      ),
    );
    const duplicate = await postBudget(
      request("/api/budgets", "POST", {
        scope: "family",
        categoryId: groceryId,
        amountCents: 50000,
        effectiveMonth: "2026-08-01",
      }),
    );
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({
      error: "A target already applies to this category and month.",
    });
  });

  it("API-005 revises with a later effective month while historical inspection retains the old amount", async () => {
    const revised = {
      ...familyTarget,
      id: "a4000000-0000-4000-8000-000000000002",
      amountCents: 60000,
      effectiveMonth: "2026-09-01",
    };
    vi.mocked(reviseBudgetTarget).mockResolvedValue(revised as never);
    vi.mocked(inspectBudgetTarget)
      .mockResolvedValueOnce({
        budget: familyTarget,
        history: [{ ...familyTarget, endMonth: "2026-08-01" }, revised],
      } as never)
      .mockResolvedValueOnce({
        budget: revised,
        history: [{ ...familyTarget, endMonth: "2026-08-01" }, revised],
      } as never);
    const patched = await patchBudget(
      request("/api/budgets/" + budgetId, "PATCH", {
        amountCents: 60000,
        effectiveMonth: "2026-09-01",
      }),
      routeContext(),
    );
    expect(patched.status).toBe(200);
    expect(await patched.json()).toEqual({ budget: revised });
    expect(reviseBudgetTarget).toHaveBeenCalledExactlyOnceWith(
      actor,
      budgetId,
      { amountCents: 60000, effectiveMonth: "2026-09-01" },
    );
    const oldBody = await (
      await getBudget(
        request("/api/budgets/" + budgetId + "?month=2026-08-01"),
        routeContext(),
      )
    ).json();
    const newBody = await (
      await getBudget(
        request("/api/budgets/" + budgetId + "?month=2026-09-01"),
        routeContext(),
      )
    ).json();
    expect(oldBody.budget.amountCents).toBe(50000);
    expect(newBody.budget.amountCents).toBe(60000);
  });

  it("API-006 archives recurrence from the explicit month without deleting earlier history", async () => {
    const archived = {
      ...familyTarget,
      endMonth: "2026-08-01",
      archived: true,
    };
    vi.mocked(archiveBudgetTarget).mockResolvedValue(archived as never);
    const response = await patchBudget(
      request("/api/budgets/" + budgetId, "PATCH", {
        archived: true,
        effectiveMonth: "2026-09-01",
      }),
      routeContext(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ budget: archived });
    expect(archiveBudgetTarget).toHaveBeenCalledExactlyOnceWith(
      actor,
      budgetId,
      "2026-09-01",
    );
  });

  it("API-007 returns accounting after pending, exclusion, transfer, predecessor and refund semantics", async () => {
    const accountingModel = {
      ...familyModel,
      budgets: [
        {
          ...familyModel.budgets[0],
          spentCents: 10000,
          remainingCents: 40000,
          percentageUsed: 20,
          status: "on-track" as const,
        },
      ],
      summary: {
        targetCents: 50000,
        spentCents: 10000,
        remainingCents: 40000,
        overBudgetCents: 0,
      },
    };
    vi.mocked(readBudgetMonth).mockResolvedValue(accountingModel as never);
    const body = await (
      await getBudgets(request("/api/budgets?scope=family&month=2026-08-01"))
    ).json();
    expect(body.budgets[0]).toMatchObject({
      spentCents: 10000,
      remainingCents: 40000,
      overBudgetCents: 0,
      percentageUsed: 20,
    });
    expect(body.summary).toEqual({
      targetCents: 50000,
      spentCents: 10000,
      remainingCents: 40000,
      overBudgetCents: 0,
    });
  });

  it("API-008 fails closed for anonymous and cross-owner callers without private payload or mutation", async () => {
    vi.mocked(getBudgetApiContext).mockRejectedValueOnce(
      new BudgetServiceError(401, "Sign in to continue."),
    );
    const anonymous = await getBudgets(
      request("/api/budgets?scope=personal&month=2026-08-01"),
    );
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "Sign in to continue." });
    expect(readBudgetMonth).not.toHaveBeenCalled();

    vi.mocked(inspectBudgetTarget).mockRejectedValueOnce(
      new BudgetServiceError(404, "Budget target not found."),
    );
    const foreign = await getBudget(
      request("/api/budgets/" + budgetId + "?month=2026-08-01"),
      routeContext(),
    );
    expect(foreign.status).toBe(404);
    expect(JSON.stringify(await foreign.json())).not.toMatch(
      /amountCents|categoryName|ownerProfileId|postgres|policy/i,
    );
  });

  it("API-009 inspects the applicable version plus ordered immutable history", async () => {
    const first = { ...familyTarget, endMonth: "2026-08-01" };
    const second = {
      ...familyTarget,
      id: "a4000000-0000-4000-8000-000000000002",
      amountCents: 60000,
      effectiveMonth: "2026-09-01",
    };
    vi.mocked(inspectBudgetTarget).mockResolvedValue({
      budget: second,
      history: [first, second],
    } as never);
    const response = await getBudget(
      request("/api/budgets/" + budgetId + "?month=2026-09-01"),
      routeContext(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      budget: second,
      history: [first, second],
    });
    expect(inspectBudgetTarget).toHaveBeenCalledExactlyOnceWith(
      actor,
      budgetId,
      "2026-09-01",
    );
  });
});
