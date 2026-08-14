// @vitest-environment node
// Redaction is a pure server concern: no DOM is needed, and skipping jsdom
// keeps the full-suite memory footprint down.
import { describe, expect, it } from "vitest";

import {
  isSensitiveKey,
  isSensitiveValue,
  redact,
  REDACTED,
} from "@/lib/security/redact";

/**
 * Real provider token shapes, so a shape rule is exercised rather than a stub.
 * Assembled at run time rather than written as literals — see the fixture
 * module for why.
 */
import {
  ACCESS_TOKEN,
  JWT,
  LINK_TOKEN,
  LONG_BASE64,
  PRODUCTION_TOKEN,
  PUBLIC_TOKEN,
  SERVICE_ROLE_JWT,
  SUPABASE_SECRET_KEY,
} from "@/lib/security/secret-shapes.fixture";

/**
 * Every key name the ticket names as secret-bearing or sensitive. The values
 * are deliberately innocuous so each case proves the *key* rule, not the
 * value-shape rule.
 */
const SENSITIVE_KEYS = [
  "access_token",
  "accessToken",
  "plaid-verification",
  "authorization",
  "cookie",
  "password",
  "secret",
  "PLAID_TOKEN_ENCRYPTION_KEY",
  "cursor",
  "amount",
  "balance",
  "email",
  "mask",
];

/**
 * The diagnosis contract. `src/lib/plaid/errors.ts` `describeCause()` emits
 * exactly these names, and an operator left with a 502 and no cause is the
 * failure mode redaction must not create.
 */
const DIAGNOSTIC_FIELDS: Array<[string, unknown]> = [
  ["error_code", "ITEM_LOGIN_REQUIRED"],
  ["error_type", "ITEM_ERROR"],
  ["request_id", "m8Wq3XrDvKn9dqW1"],
  ["errorCode", "ITEM_LOGIN_REQUIRED"],
  ["errorType", "ITEM_ERROR"],
  ["requestId", "m8Wq3XrDvKn9dqW1"],
  ["status", 502],
  ["code", "PGRST116"],
  ["hint", "Perhaps you meant the table public.accounts"],
  ["source", "plaid"],
  ["operation", "exchange"],
];

describe("GH-14 secret-bearing key redaction (F4)", () => {
  it("SEC-101 publishes the marker the ticket specifies", () => {
    expect(REDACTED).toBe("[redacted]");
  });

  it.each(SENSITIVE_KEYS)("SEC-102 recognizes %s as a secret key", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(SENSITIVE_KEYS)(
    "SEC-103 removes the top-level value of %s",
    (key) => {
      expect(redact({ [key]: "harmless-looking" })).toEqual({
        [key]: REDACTED,
      });
    },
  );

  it("SEC-104 redacts at depth, inside nested objects and arrays", () => {
    const redacted = redact({
      operation: "exchange",
      request: {
        headers: {
          authorization: `Bearer ${ACCESS_TOKEN}`,
          cookie: "sb-access-token=abc; sb-refresh-token=def",
          "plaid-verification": JWT,
        },
      },
      items: [
        {
          access_token: ACCESS_TOKEN,
          cursor: "cursor-page-2",
          error_code: "ITEM_LOGIN_REQUIRED",
        },
        { accounts: [{ balance: 1234, mask: "5678" }] },
      ],
    });

    expect(redacted).toEqual({
      operation: "exchange",
      request: {
        headers: {
          authorization: REDACTED,
          cookie: REDACTED,
          "plaid-verification": REDACTED,
        },
      },
      items: [
        {
          access_token: REDACTED,
          cursor: REDACTED,
          error_code: "ITEM_LOGIN_REQUIRED",
        },
        { accounts: [{ balance: REDACTED, mask: REDACTED }] },
      ],
    });
  });

  it("SEC-105 redacts the enumerable properties of an Error", () => {
    const error = Object.assign(new Error("Plaid exchange failed"), {
      access_token: ACCESS_TOKEN,
      error_code: "INVALID_ACCESS_TOKEN",
      request_id: "m8Wq3XrDvKn9dqW1",
    });

    const serialized = JSON.stringify(redact(error));

    expect(serialized).not.toContain(ACCESS_TOKEN);
    expect(serialized).toContain(REDACTED);
    expect(serialized).toContain("INVALID_ACCESS_TOKEN");
    expect(serialized).toContain("m8Wq3XrDvKn9dqW1");
  });
});

describe("GH-14 redaction does not destroy diagnosis (F4)", () => {
  it.each(DIAGNOSTIC_FIELDS)("SEC-106 keeps %s intact", (key, value) => {
    expect(isSensitiveKey(key)).toBe(false);
    expect(redact({ [key]: value })).toEqual({ [key]: value });
  });

  it("SEC-107 passes the real describeCause Plaid projection through untouched", () => {
    // Byte-for-byte the object src/lib/plaid/errors.ts builds for a provider
    // rejection. Every field here is what an operator diagnoses a 502 with.
    const describeCauseOutput = {
      source: "plaid",
      status: 400,
      errorCode: "INVALID_ACCESS_TOKEN",
      errorType: "INVALID_INPUT",
      requestId: "m8Wq3XrDvKn9dqW1",
    };

    expect(redact({ operation: "exchange", ...describeCauseOutput })).toEqual({
      operation: "exchange",
      ...describeCauseOutput,
    });
  });

  it("SEC-108 passes the real describeCause database projection through untouched", () => {
    const describeCauseOutput = {
      source: "database",
      code: "23514",
      hint: null,
      message: "new row violates check constraint",
    };

    expect(redact({ operation: "activate", ...describeCauseOutput })).toEqual({
      operation: "activate",
      ...describeCauseOutput,
    });
  });
});

describe("GH-14 secret-shaped value redaction (F4)", () => {
  it.each([
    ["a JWT", JWT],
    ["a Sandbox access token", ACCESS_TOKEN],
    ["a Production access token", PRODUCTION_TOKEN],
    ["a link token", LINK_TOKEN],
    ["a public token", PUBLIC_TOKEN],
    ["a long base64 secret", LONG_BASE64],
  ])("SEC-109 redacts %s regardless of its key name", (_case, value) => {
    expect(isSensitiveValue(value)).toBe(true);
    expect(redact({ note: value })).toEqual({ note: REDACTED });
    expect(redact({ details: [{ label: value }] })).toEqual({
      details: [{ label: REDACTED }],
    });
  });

  it.each([
    ["ordinary prose", "Plaid could not verify that connection."],
    ["a merchant name", "Northern Grocer weekly shop"],
    ["a short identifier", "txn-1042"],
    ["an ISO date", "2026-08-14T12:00:00.000Z"],
    ["a provider error code", "ITEM_LOGIN_REQUIRED"],
  ])("SEC-110 leaves %s alone", (_case, value) => {
    expect(isSensitiveValue(value)).toBe(false);
    expect(redact({ note: value })).toEqual({ note: value });
  });
});

describe("GH-14 redaction is safe on hostile input (F4)", () => {
  it("SEC-111 does not hang or throw on a self-referential object", () => {
    const cyclic: Record<string, unknown> = {
      operation: "sync",
      access_token: ACCESS_TOKEN,
    };
    cyclic.self = cyclic;
    cyclic.nested = { parent: cyclic, siblings: [cyclic] };

    let redacted: unknown;
    expect(() => {
      redacted = redact(cyclic);
    }).not.toThrow();
    expect(JSON.stringify(redacted, replaceCycles())).not.toContain(
      ACCESS_TOKEN,
    );
  });

  it("SEC-112 never mutates its input", () => {
    const input = {
      operation: "sync",
      access_token: ACCESS_TOKEN,
      response: { data: { error_code: "ITEM_LOGIN_REQUIRED", cursor: "abc" } },
      pages: [{ authorization: `Bearer ${JWT}` }],
    };
    const before = structuredClone(input);

    redact(input);

    expect(input).toEqual(before);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["a boolean", true],
    ["an empty object", {}],
    ["an empty array", []],
  ])("SEC-113 handles %s without throwing", (_case, value) => {
    expect(() => redact(value)).not.toThrow();
  });
});

describe("GH-14 realistic Plaid failure payload (F4)", () => {
  it("SEC-114 strips the token from an axios-style error and keeps the codes", () => {
    const providerError = {
      response: {
        status: 400,
        data: {
          error_code: "INVALID_ACCESS_TOKEN",
          error_type: "INVALID_INPUT",
          request_id: "m8Wq3XrDvKn9dqW1",
          access_token: ACCESS_TOKEN,
        },
      },
    };

    const redacted = redact(providerError);

    expect(redacted).toEqual({
      response: {
        status: 400,
        data: {
          error_code: "INVALID_ACCESS_TOKEN",
          error_type: "INVALID_INPUT",
          request_id: "m8Wq3XrDvKn9dqW1",
          access_token: REDACTED,
        },
      },
    });
    expect(JSON.stringify(redacted)).not.toContain(ACCESS_TOKEN);
  });

  it("SEC-120 scrubs a secret embedded inside a longer message", () => {
    // The shape secrets actually leak in: a driver or HTTP client quoting the
    // offending value back inside a sentence. Whole-string matching alone let
    // every one of these through.
    const cases = [
      `connection terminated while sending ${SUPABASE_SECRET_KEY}`,
      `POST /item/get failed for ${ACCESS_TOKEN} after 3 retries`,
      `invalid jwt ${SERVICE_ROLE_JWT} supplied`,
    ];

    for (const message of cases) {
      const scrubbed = redact({ detail: message }) as { detail: string };
      expect(scrubbed.detail).toContain(REDACTED);
      expect(scrubbed.detail).not.toContain(SUPABASE_SECRET_KEY);
      expect(scrubbed.detail).not.toContain(ACCESS_TOKEN);
    }
  });

  it("SEC-121 scrubs a secret carried in an Error message rather than a field", () => {
    const error = new Error(
      `rpc failed: token ${ACCESS_TOKEN} was rejected`,
    ) as Error & { code: string };
    error.code = "PGRST301";

    const redacted = redact({ error }) as {
      error: { message: string; code: string; name: string };
    };

    expect(redacted.error.message).not.toContain(ACCESS_TOKEN);
    expect(redacted.error.message).toContain(REDACTED);
    // Diagnosis still survives the scrub.
    expect(redacted.error.code).toBe("PGRST301");
    expect(redacted.error.name).toBe("Error");
  });

  it("SEC-122 leaves ordinary prose and short identifiers intact", () => {
    const message =
      "Plaid sync failed for item 3 of 12 after 2 retries at 2026-08-14T12:00:00.000Z";

    expect((redact({ detail: message }) as { detail: string }).detail).toBe(
      message,
    );
  });
});

/** JSON replacer that tolerates the cycles SEC-111 deliberately builds. */
function replaceCycles() {
  const seen = new WeakSet<object>();
  return (_key: string, value: unknown) => {
    if (value && typeof value === "object") {
      if (seen.has(value)) return "[cycle]";
      seen.add(value);
    }
    return value;
  };
}
