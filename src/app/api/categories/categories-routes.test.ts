import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/categories/service", () => {
  class CategoryServiceError extends Error {
    constructor(
      public readonly status: 400 | 401 | 403 | 404 | 409,
      message: string,
      public readonly fields?: Record<string, string[]>,
    ) {
      super(message);
    }
  }

  return {
    CategoryServiceError,
    getApiContext: vi.fn(),
    listCategoriesAndRules: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    listTransactions: vi.fn(),
    setManualCategory: vi.fn(),
    previewMerchantRule: vi.fn(),
    createMerchantRule: vi.fn(),
    updateMerchantRule: vi.fn(),
    toApiErrorResponse: vi.fn((error: unknown) => {
      if (error instanceof CategoryServiceError) {
        return Response.json(
          {
            error: error.message,
            ...(error.fields ? { fields: error.fields } : {}),
          },
          { status: error.status },
        );
      }
      return Response.json(
        {
          error: "Check the highlighted fields.",
          fields: { request: ["Invalid request."] },
        },
        { status: 400 },
      );
    }),
  };
});

import {
  CategoryServiceError,
  createCategory,
  createMerchantRule,
  getApiContext,
  listCategoriesAndRules,
  listTransactions,
  previewMerchantRule,
  setManualCategory,
  updateCategory,
} from "@/lib/categories/service";
import { GET as getCategories, POST as postCategory } from "./route";
import { PATCH as patchCategory } from "./[id]/route";
import { GET as getTransactions } from "../transactions/route";
import { PATCH as patchTransactionCategory } from "../transactions/[id]/category/route";
import { POST as previewRule } from "../merchant-rules/preview/route";
import { POST as postRule } from "../merchant-rules/route";

const actor = {
  supabase: {},
  userId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000001",
};
const familyCategory = {
  id: "30000000-0000-4000-8000-000000000001",
  name: "Groceries",
  color: "#18745B",
  scope: "family" as const,
  ownerProfileId: null,
  systemKey: null,
  archivedAt: null,
  inUse: true,
};
const personalCategory = {
  ...familyCategory,
  id: "30000000-0000-4000-8000-000000000002",
  name: "Quiet treats",
  scope: "personal" as const,
  ownerProfileId: actor.userId,
  inUse: false,
};
const transactionId = "40000000-0000-4000-8000-000000000001";

function jsonRequest(path: string, method: "POST" | "PATCH", body: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getApiContext).mockResolvedValue(actor as never);
});

describe("GH-7 category route acceptance", () => {
  it("API-001 GET lists only privacy-scoped categories and rules returned for the authenticated actor", async () => {
    vi.mocked(listCategoriesAndRules).mockResolvedValue({
      categories: [familyCategory, personalCategory],
      rules: [
        {
          id: "50000000-0000-4000-8000-000000000001",
          categoryId: familyCategory.id,
          scope: "family",
          ownerProfileId: null,
          matchType: "merchant_id",
          matchValue: "entity-grocer",
          enabled: true,
          archivedAt: null,
          createdBy: actor.userId,
          createdAt: "2026-08-12T12:00:00.000Z",
          updatedAt: "2026-08-12T12:00:00.000Z",
        },
      ],
    });

    const response = await getCategories();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      categories: [familyCategory, personalCategory],
      rules: expect.any(Array),
    });
    expect(listCategoriesAndRules).toHaveBeenCalledExactlyOnceWith(actor);
  });

  it("API-002 POST creates canonical Family and Personal categories", async () => {
    vi.mocked(createCategory)
      .mockResolvedValueOnce(familyCategory)
      .mockResolvedValueOnce(personalCategory);

    const familyResponse = await postCategory(
      jsonRequest("/api/categories", "POST", {
        name: "  Groceries ",
        color: "#18745B",
        scope: "family",
      }),
    );
    const personalResponse = await postCategory(
      jsonRequest("/api/categories", "POST", {
        name: " Quiet treats ",
        color: "#18745B",
        scope: "personal",
      }),
    );

    expect([familyResponse.status, personalResponse.status]).toEqual([
      201, 201,
    ]);
    expect(await familyResponse.json()).toEqual({ category: familyCategory });
    expect(await personalResponse.json()).toEqual({
      category: personalCategory,
    });
    expect(createCategory).toHaveBeenNthCalledWith(1, actor, {
      name: "Groceries",
      color: "#18745B",
      scope: "family",
    });
    expect(createCategory).toHaveBeenNthCalledWith(2, actor, {
      name: "Quiet treats",
      color: "#18745B",
      scope: "personal",
    });
  });

  it("API-003 duplicate and invalid categories return sanitized conflict or field errors", async () => {
    vi.mocked(createCategory).mockRejectedValueOnce(
      new CategoryServiceError(
        409,
        "An active category already uses that name.",
      ),
    );

    const duplicate = await postCategory(
      jsonRequest("/api/categories", "POST", {
        name: "Groceries",
        color: "#18745B",
        scope: "family",
      }),
    );
    const invalid = await postCategory(
      jsonRequest("/api/categories", "POST", {
        name: "",
        color: "not-a-color",
        scope: "secret",
        leakedColumn: "provider_payload",
      }),
    );

    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({
      error: "An active category already uses that name.",
    });
    expect(invalid.status).toBe(400);
    const invalidBody = await invalid.json();
    expect(invalidBody).toHaveProperty("error");
    expect(JSON.stringify(invalidBody)).not.toMatch(
      /provider_payload|postgres|duplicate key|constraint/i,
    );
  });

  it("API-004 PATCH archives an in-use custom category without deleting historical identity", async () => {
    const archived = {
      ...familyCategory,
      archivedAt: "2026-08-12T13:00:00.000Z",
    };
    vi.mocked(updateCategory).mockResolvedValue(archived);

    const response = await patchCategory(
      jsonRequest(`/api/categories/${familyCategory.id}`, "PATCH", {
        archived: true,
      }),
      routeContext(familyCategory.id),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ category: archived });
    expect(updateCategory).toHaveBeenCalledExactlyOnceWith(
      actor,
      familyCategory.id,
      { archived: true },
    );
  });

  it("API-005 transaction list exposes immutable original Plaid category separately from effective category", async () => {
    const transaction = {
      id: transactionId,
      scope: "family" as const,
      ownerProfileId: null,
      merchantName: "Green Market",
      name: "GREEN MARKET 042",
      amount: 42.75,
      transactionDate: "2026-08-11",
      pending: false,
      originalPlaidCategory: {
        primary: "FOOD_AND_DRINK",
        detailed: "FOOD_AND_DRINK_GROCERIES",
      },
      effectiveCategory: {
        id: familyCategory.id,
        name: familyCategory.name,
        color: familyCategory.color,
        source: "rule" as const,
        updatedBy: actor.userId,
        updatedAt: "2026-08-12T12:00:00.000Z",
      },
      stableMerchantId: "entity-grocer",
      normalizedMerchant: "green market",
    };
    vi.mocked(listTransactions).mockResolvedValue([transaction]);

    const response = await getTransactions(
      new Request("http://localhost/api/transactions?limit=50"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ transactions: [transaction] });
    expect(listTransactions).toHaveBeenCalledExactlyOnceWith(actor, 50);
  });

  it("API-006 manual recategorization changes metadata only and returns actor/time attribution", async () => {
    const recategorized = {
      id: transactionId,
      scope: "personal" as const,
      ownerProfileId: actor.userId,
      merchantName: "Green Market",
      name: "GREEN MARKET 042",
      amount: 42.75,
      transactionDate: "2026-08-11",
      pending: false,
      originalPlaidCategory: {
        primary: "FOOD_AND_DRINK",
        detailed: "FOOD_AND_DRINK_GROCERIES",
      },
      effectiveCategory: {
        id: personalCategory.id,
        name: personalCategory.name,
        color: personalCategory.color,
        source: "manual" as const,
        updatedBy: actor.userId,
        updatedAt: "2026-08-12T13:00:00.000Z",
      },
      stableMerchantId: "entity-grocer",
      normalizedMerchant: "green market",
    };
    vi.mocked(setManualCategory).mockResolvedValue(recategorized);

    const response = await patchTransactionCategory(
      jsonRequest(`/api/transactions/${transactionId}/category`, "PATCH", {
        categoryId: personalCategory.id,
      }),
      routeContext(transactionId),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ transaction: recategorized });
    expect(setManualCategory).toHaveBeenCalledExactlyOnceWith(
      actor,
      transactionId,
      personalCategory.id,
    );
  });

  it("API-007 preview reports the exact eligible existing-match count", async () => {
    vi.mocked(previewMerchantRule).mockResolvedValue({
      matcher: { matchType: "merchant_id", matchValue: "entity-grocer" },
      matchCount: 3,
    });

    const response = await previewRule(
      jsonRequest("/api/merchant-rules/preview", "POST", {
        transactionId,
        categoryId: familyCategory.id,
        scope: "family",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      matcher: { matchType: "merchant_id", matchValue: "entity-grocer" },
      matchCount: 3,
    });
    expect(previewMerchantRule).toHaveBeenCalledExactlyOnceWith(actor, {
      transactionId,
      categoryId: familyCategory.id,
      scope: "family",
    });
  });

  it("API-008 confirmed rule creation reports updated count while service preserves manual overrides", async () => {
    const rule = {
      id: "50000000-0000-4000-8000-000000000001",
      categoryId: familyCategory.id,
      scope: "family" as const,
      ownerProfileId: null,
      matchType: "merchant_id" as const,
      matchValue: "entity-grocer",
      enabled: true,
      archivedAt: null,
      createdBy: actor.userId,
      createdAt: "2026-08-12T14:00:00.000Z",
      updatedAt: "2026-08-12T14:00:00.000Z",
    };
    vi.mocked(createMerchantRule).mockResolvedValue({ rule, updatedCount: 3 });

    const response = await postRule(
      jsonRequest("/api/merchant-rules", "POST", {
        transactionId,
        categoryId: familyCategory.id,
        scope: "family",
        applyExisting: true,
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ rule, updatedCount: 3 });
    expect(createMerchantRule).toHaveBeenCalledExactlyOnceWith(actor, {
      transactionId,
      categoryId: familyCategory.id,
      scope: "family",
      applyExisting: true,
    });
  });

  it("API-009 unauthenticated, cross-member Personal, and cross-domain mutations fail closed", async () => {
    vi.mocked(getApiContext).mockRejectedValueOnce(
      new CategoryServiceError(401, "Sign in to continue."),
    );
    vi.mocked(updateCategory)
      .mockRejectedValueOnce(
        new CategoryServiceError(404, "Category not found."),
      )
      .mockRejectedValueOnce(
        new CategoryServiceError(403, "That category is not available here."),
      );

    const unauthenticated = await postCategory(
      jsonRequest("/api/categories", "POST", {
        name: "Dining",
        color: "#18745B",
        scope: "family",
      }),
    );
    const foreignPersonal = await patchCategory(
      jsonRequest(`/api/categories/${personalCategory.id}`, "PATCH", {
        archived: true,
      }),
      routeContext(personalCategory.id),
    );
    const crossDomain = await patchCategory(
      jsonRequest(`/api/categories/${familyCategory.id}`, "PATCH", {
        name: "Private family",
      }),
      routeContext(familyCategory.id),
    );

    expect([
      unauthenticated.status,
      foreignPersonal.status,
      crossDomain.status,
    ]).toEqual([401, 404, 403]);
    for (const response of [unauthenticated, foreignPersonal, crossDomain]) {
      expect(JSON.stringify(await response.json())).not.toMatch(
        /postgres|policy|row.level|constraint|provider_payload/i,
      );
    }
  });
});
