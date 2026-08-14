// @vitest-environment node
// The sanctioned logger is server-only: no DOM is needed, and skipping jsdom
// keeps the full-suite memory footprint down.
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import { logServerEvent, type ServerLogLevel } from "@/lib/security/log";
import { redact, REDACTED } from "@/lib/security/redact";

import {
  ACCESS_TOKEN,
  LONG_BASE64 as SERVICE_ROLE_KEY,
} from "@/lib/security/secret-shapes.fixture";

const CONSOLE_METHODS = ["error", "warn", "info"] as const;
type ConsoleMethod = (typeof CONSOLE_METHODS)[number];

// The spies are installed per test: a module-level spy plus restoreAllMocks
// silently stops capturing after the first case, which turns every "no secret
// was written" assertion into a false pass.
const spies = {} as Record<ConsoleMethod, MockInstance>;

beforeEach(() => {
  for (const method of CONSOLE_METHODS) {
    spies[method] = vi
      .spyOn(console, method)
      .mockImplementation(() => undefined);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Everything the logger handed to the console, as one searchable string. */
function written(): string {
  return JSON.stringify(
    CONSOLE_METHODS.flatMap((method) => spies[method].mock.calls),
    (_key, value) => (value instanceof Error ? { ...value } : value),
  );
}

describe("GH-14 sanctioned server logging (F4)", () => {
  it("SEC-200 installs working console spies", () => {
    // Guards the guard: if this fails, every "no secret was written"
    // assertion below is vacuous.
    console.error("probe");
    expect(spies.error).toHaveBeenCalledTimes(1);
    expect(written()).toContain("probe");
  });

  it.each<[ServerLogLevel, ConsoleMethod]>([
    ["error", "error"],
    ["warn", "warn"],
    ["info", "info"],
  ])("SEC-201 routes a %s event to console.%s alone", (level, method) => {
    logServerEvent(level, "Plaid sync failed", { itemId: "item-1" });

    expect(spies[method]).toHaveBeenCalledTimes(1);
    for (const other of CONSOLE_METHODS) {
      if (other !== method) expect(spies[other]).not.toHaveBeenCalled();
    }
    expect(written()).toContain("Plaid sync failed");
  });

  it("SEC-202 writes the redacted projection of the context", () => {
    const context = {
      itemId: "50000000-0000-4000-8000-000000000001",
      access_token: ACCESS_TOKEN,
      response: {
        status: 400,
        data: {
          error_code: "INVALID_ACCESS_TOKEN",
          error_type: "INVALID_INPUT",
          request_id: "m8Wq3XrDvKn9dqW1",
        },
      },
    };
    const expected = JSON.stringify(redact(context));

    logServerEvent("error", "Plaid flow failed", context);

    const serialized = written();
    // Accepts a structured second argument or a pre-serialized line; both
    // carry the redacted projection verbatim.
    expect(
      serialized.includes(expected) ||
        serialized.includes(JSON.stringify(expected).slice(1, -1)),
      `expected the console arguments to carry ${expected}, got ${serialized}`,
    ).toBe(true);
    expect(serialized).toContain(REDACTED);
  });

  it("SEC-203 never emits a secret substring anywhere in its arguments", () => {
    logServerEvent("error", "Authentication operation failed", {
      access_token: ACCESS_TOKEN,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
      headers: {
        authorization: `Bearer ${ACCESS_TOKEN}`,
        cookie: `sb-access-token=${ACCESS_TOKEN}`,
      },
      pages: [{ cursor: "cursor-page-2", access_token: ACCESS_TOKEN }],
      cause: Object.assign(new Error("boom"), { password: "hunter2-correct" }),
    });

    const serialized = written();
    expect(serialized).not.toBe("[]");
    expect(serialized).not.toContain(ACCESS_TOKEN);
    expect(serialized).not.toContain(SERVICE_ROLE_KEY);
    expect(serialized).not.toContain("cursor-page-2");
    expect(serialized).not.toContain("hunter2-correct");
  });

  it("SEC-204 preserves the diagnosis fields an operator needs", () => {
    logServerEvent("warn", "Plaid sync failed", {
      itemId: "50000000-0000-4000-8000-000000000001",
      source: "plaid",
      status: 502,
      error_code: "INTERNAL_SERVER_ERROR",
      error_type: "API_ERROR",
      request_id: "m8Wq3XrDvKn9dqW1",
      access_token: ACCESS_TOKEN,
    });

    const serialized = written();
    expect(serialized).toContain("INTERNAL_SERVER_ERROR");
    expect(serialized).toContain("API_ERROR");
    expect(serialized).toContain("m8Wq3XrDvKn9dqW1");
    expect(serialized).toContain("502");
    expect(serialized).not.toContain(ACCESS_TOKEN);
  });

  it("SEC-205 logs a message with no context without throwing", () => {
    expect(() => logServerEvent("info", "Plaid sync completed")).not.toThrow();
    expect(spies.info).toHaveBeenCalledTimes(1);
    expect(written()).toContain("Plaid sync completed");
  });

  it("SEC-206 tolerates a non-object context", () => {
    for (const context of [null, undefined, "raw string", 42, [ACCESS_TOKEN]]) {
      expect(() =>
        logServerEvent("error", "Odd context", context),
      ).not.toThrow();
    }
    expect(spies.error).toHaveBeenCalledTimes(5);
    expect(written()).not.toContain(ACCESS_TOKEN);
  });
});
