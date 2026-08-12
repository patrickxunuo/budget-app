import { describe, expect, it } from "vitest";
import {
  manualEntryInputSchema,
  manualEntryListQuerySchema,
} from "./validation";

const base = {
  scope: "family",
  kind: "income",
  amount: "12.50",
  entryDate: "2026-08-12",
  description: "Cash",
  categoryId: "11111111-1111-4111-8111-111111111111",
};
describe("manualEntryInputSchema", () => {
  it("accepts signed canonical CAD values", () =>
    expect(manualEntryInputSchema.parse(base).amount).toBe("12.50"));
  it("rejects an impossible date", () =>
    expect(() =>
      manualEntryInputSchema.parse({ ...base, entryDate: "2026-02-30" }),
    ).toThrow());
  it("enforces kind signs", () =>
    expect(() =>
      manualEntryInputSchema.parse({
        ...base,
        kind: "spending",
        amount: "1.00",
      }),
    ).toThrow());
  it("requires an explicit privacy scope for ledger reads", () => {
    expect(manualEntryListQuerySchema.safeParse({}).success).toBe(false);
    expect(manualEntryListQuerySchema.parse({ scope: "family" })).toEqual({
      scope: "family",
      format: "json",
    });
  });
});
