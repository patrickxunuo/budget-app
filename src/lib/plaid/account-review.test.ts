import { describe, expect, it } from "vitest";

import {
  normalizeAccountIdentity,
  reviewEligibility,
  toAccountKind,
} from "./account-review";

const base = {
  accountId: "a",
  name: "Everyday",
  officialName: null,
  mask: "1204",
  type: "depository",
  subtype: "checking",
  currencyCode: "CAD",
};

describe("Plaid account review rules", () => {
  it("accepts only supported CAD account kinds", () => {
    expect(reviewEligibility(base)).toEqual({ eligible: true, message: null });
    expect(toAccountKind({ ...base, subtype: "checking" })).toBe("chequing");
    expect(toAccountKind({ ...base, subtype: "savings" })).toBe("savings");
    expect(
      toAccountKind({ ...base, type: "credit", subtype: "credit card" }),
    ).toBe("credit_card");
  });

  it("keeps unsupported and non-CAD accounts visible with actionable explanations", () => {
    expect(reviewEligibility({ ...base, currencyCode: "USD" })).toMatchObject({
      eligible: false,
      message: expect.stringMatching(/Canadian-dollar/),
    });
    expect(
      reviewEligibility({ ...base, type: "investment", subtype: "brokerage" }),
    ).toMatchObject({
      eligible: false,
      message: expect.stringMatching(/not supported/),
    });
  });

  it("normalizes names for conservative duplicate matching", () => {
    expect(normalizeAccountIdentity("  Rainy-Day SAVINGS!! ")).toBe(
      "rainy day savings",
    );
  });
});
