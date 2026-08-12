import { describe, expect, it } from "vitest";

import { normalizeMerchantMatcher, resolveEffectiveCategory } from "./domain";
import {
  createCategorySchema,
  createRuleSchema,
  manualCategorySchema,
  previewRuleSchema,
  transactionListQuerySchema,
  updateCategorySchema,
  updateRuleSchema,
} from "./validation";

const category = (id: string, name: string) => ({
  id,
  name,
  color: "#18745B",
  scope: "family" as const,
  ownerProfileId: null,
  systemKey: null,
  archivedAt: null,
  inUse: false,
});

describe("GH-7 category domain acceptance", () => {
  it("DOM-001 prefers stable merchant identity, normalizes conservative fallback, and rejects unsafe blank fallback", () => {
    expect(
      normalizeMerchantMatcher({
        stableMerchantId: " Entity-Plaid-123 ",
        merchantName: "  CAFÉ\u00a0 DE   FLORE  ",
        name: "ignored source name",
      }),
    ).toEqual({ matchType: "merchant_id", matchValue: " Entity-Plaid-123 " });

    expect(
      normalizeMerchantMatcher({
        stableMerchantId: null,
        merchantName: "  CAFÉ\u00a0 DE   FLORE  ",
        name: "ignored source name",
      }),
    ).toEqual({ matchType: "normalized_name", matchValue: "café de flore" });

    expect(
      normalizeMerchantMatcher({
        stableMerchantId: null,
        merchantName: "   ",
        name: "\u200b\u00a0",
      }),
    ).toBeNull();
  });

  it("DOM-002 resolves manual, rule, Plaid, and uncategorized precedence in that exact order", () => {
    const manual = category("manual", "Manual category");
    const rule = category("rule", "Rule category");
    const plaid = category("plaid", "Plaid category");
    const attribution = {
      updatedBy: "10000000-0000-4000-8000-000000000001",
      updatedAt: "2026-08-12T12:00:00.000Z",
    };

    expect(
      resolveEffectiveCategory({ manual, rule, plaid, ...attribution }),
    ).toMatchObject({ id: "manual", source: "manual", ...attribution });
    expect(
      resolveEffectiveCategory({ manual: null, rule, plaid, ...attribution }),
    ).toMatchObject({ id: "rule", source: "rule", ...attribution });
    expect(
      resolveEffectiveCategory({ manual: null, rule: null, plaid }),
    ).toEqual({
      id: "plaid",
      name: "Plaid category",
      color: "#18745B",
      source: "plaid",
      updatedBy: null,
      updatedAt: null,
    });
    expect(
      resolveEffectiveCategory({ manual: null, rule: null, plaid: null }),
    ).toBeNull();
  });

  it("DOM-003 validates only supported scopes, colors, UUIDs, limits, and exact mutation shapes", () => {
    const categoryId = "10000000-0000-4000-8000-000000000001";
    const transactionId = "20000000-0000-4000-8000-000000000001";

    expect(
      createCategorySchema.parse({
        name: "  Groceries  ",
        color: "#18745b",
        scope: "family",
      }),
    ).toEqual({ name: "Groceries", color: "#18745B", scope: "family" });
    expect(
      updateCategorySchema.parse({ name: "Dining", archived: true }),
    ).toEqual({ name: "Dining", archived: true });
    expect(
      transactionListQuerySchema.parse({ limit: "1", scope: "family" }),
    ).toEqual({
      limit: 1,
      scope: "family",
      inclusion: "default",
    });
    expect(
      transactionListQuerySchema.parse({ limit: "100", scope: "personal" }),
    ).toEqual({
      limit: 100,
      scope: "personal",
      inclusion: "default",
    });
    expect(manualCategorySchema.parse({ categoryId })).toEqual({ categoryId });
    expect(
      previewRuleSchema.parse({ transactionId, categoryId, scope: "personal" }),
    ).toEqual({ transactionId, categoryId, scope: "personal" });
    expect(
      createRuleSchema.parse({
        transactionId,
        categoryId,
        scope: "family",
        applyExisting: true,
      }),
    ).toEqual({
      transactionId,
      categoryId,
      scope: "family",
      applyExisting: true,
    });
    expect(updateRuleSchema.parse({ enabled: false })).toEqual({
      enabled: false,
    });

    for (const invalid of [
      { name: "Bad", color: "green", scope: "family" },
      { name: "Bad", color: "#12345g", scope: "family" },
      { name: "Bad", color: "#123456", scope: "workspace" },
      { name: "Bad", color: "#123456", scope: "personal", extra: true },
    ]) {
      expect(createCategorySchema.safeParse(invalid).success).toBe(false);
    }
    for (const limit of ["0", "101", "1.5", "many"]) {
      expect(
        transactionListQuerySchema.safeParse({ limit, scope: "family" })
          .success,
      ).toBe(false);
    }
    expect(
      transactionListQuerySchema.safeParse({
        scope: "family",
        from: "2026-02-30",
      }).success,
    ).toBe(false);
    expect(
      transactionListQuerySchema.safeParse({
        scope: "family",
        from: "2026-08-31",
        to: "2026-08-01",
      }).success,
    ).toBe(false);
    expect(
      transactionListQuerySchema.parse({
        scope: "family",
        from: "2026-08-01",
        to: "2026-08-31",
      }),
    ).toEqual({
      limit: 50,
      scope: "family",
      from: "2026-08-01",
      to: "2026-08-31",
      inclusion: "default",
    });
    expect(
      manualCategorySchema.safeParse({ categoryId: "not-a-uuid" }).success,
    ).toBe(false);
    expect(updateCategorySchema.safeParse({}).success).toBe(false);
    expect(updateRuleSchema.safeParse({}).success).toBe(false);
  });
});
