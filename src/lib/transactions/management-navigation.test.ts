import { describe, expect, it } from "vitest";

import { resolveTransactionReturnTo } from "./management-navigation";

describe("GH-64 transaction management return navigation", () => {
  it.each([
    ["/transactions", "/transactions"],
    [
      "/transactions?scope=personal&period=week&reference=2026-08-24&search=coffee",
      "/transactions?scope=personal&period=week&reference=2026-08-24&search=coffee",
    ],
  ])(
    "API-004 preserves a safe relative Transactions target",
    (raw, expected) => {
      expect(resolveTransactionReturnTo(raw, "personal")).toBe(expected);
    },
  );

  it.each([
    [undefined],
    [""],
    ["https://evil.example/transactions"],
    ["//evil.example/transactions"],
    ["https://user:secret@evil.example/transactions"],
    ["/transactions/manual"],
    ["/categories?scope=family"],
    ["transactions?scope=personal"],
    ["javascript:alert(1)"],
    [["/transactions?scope=personal", "/transactions?scope=family"]],
  ])(
    "API-004 rejects unsafe, malformed, repeated, or absent returnTo: %j",
    (raw) => {
      expect(resolveTransactionReturnTo(raw, "personal")).toBe(
        "/transactions?scope=personal",
      );
    },
  );

  it("API-004 falls back to the Family overview without adding its default scope query", () => {
    expect(resolveTransactionReturnTo("/transactions/plaid", "family")).toBe(
      "/transactions?scope=family",
    );
  });
});
