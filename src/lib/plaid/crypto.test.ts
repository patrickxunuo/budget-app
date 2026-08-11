import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { decryptAccessToken, encryptAccessToken } from "./crypto";

describe("Plaid token encryption", () => {
  it("round-trips only with the configured key", () => {
    const encrypted = encryptAccessToken(
      "access-sandbox-secret",
      "a".repeat(32),
    );
    expect(encrypted.toString("utf8")).not.toContain("access-sandbox-secret");
    expect(decryptAccessToken(encrypted, "a".repeat(32))).toBe(
      "access-sandbox-secret",
    );
    expect(() => decryptAccessToken(encrypted, "b".repeat(32))).toThrow();
  });

  it("rejects authenticated ciphertext after tampering", () => {
    const encrypted = encryptAccessToken(
      "access-sandbox-secret",
      "a".repeat(32),
    );
    encrypted[encrypted.length - 1] = (encrypted.at(-1) ?? 0) ^ 1;
    expect(() => decryptAccessToken(encrypted, "a".repeat(32))).toThrow();
  });
});
