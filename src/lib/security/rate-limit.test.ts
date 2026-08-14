// @vitest-environment node
// The limiter is server-only and database-backed: no DOM is needed, and
// skipping jsdom keeps the full-suite memory footprint down.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/env/server", () => ({
  getServerEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijkl.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key-must-never-be-logged",
  }),
}));

// The real client is never constructed, so the suite needs no database. The
// stub answers both `admin.rpc(...)` and `admin.schema("private").rpc(...)`.
vi.mock("@/lib/supabase/admin", () => {
  const client: Record<string, unknown> = { rpc: mocks.rpc };
  client.schema = () => client;
  return { createSupabaseAdminClient: () => client };
});

import {
  consumeRateLimit,
  rateLimitSubject,
  resetRateLimit,
  type RateLimitBucket,
} from "@/lib/security/rate-limit";

const BUCKETS: RateLimitBucket[] = [
  "sign_in",
  "password_reset",
  "invitation_accept",
  "password_confirm",
  "auth_callback",
  "plaid_webhook",
];

const CLIENT_IP = "203.0.113.7";
const MEMBER_EMAIL = "member@example.test";
const SUBJECT = "8f14e45fceea167a5a36dedd4bea2543";

/** A row carrying both the camelCase and snake_case spellings of the verdict. */
const ALLOWED_ROW = {
  allowed: true,
  remaining: 4,
  retryAfterSeconds: 30,
  retry_after_seconds: 30,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: ALLOWED_ROW, error: null });
});

function lastRpcArgs(): Record<string, unknown> {
  const call = mocks.rpc.mock.calls.at(-1);
  expect(call, "the limiter never reached the RPC").toBeDefined();
  return (call![1] ?? {}) as Record<string, unknown>;
}

describe("GH-14 rate-limit subject derivation (F3)", () => {
  it("SEC-501 is stable for the same client", () => {
    const headers = new Headers({ "x-forwarded-for": CLIENT_IP });

    expect(rateLimitSubject(headers)).toBe(rateLimitSubject(headers));
    expect(
      rateLimitSubject(new Headers({ "x-forwarded-for": CLIENT_IP })),
    ).toBe(rateLimitSubject(new Headers({ "x-forwarded-for": CLIENT_IP })));
  });

  it("SEC-502 separates different clients", () => {
    expect(
      rateLimitSubject(new Headers({ "x-forwarded-for": CLIENT_IP })),
    ).not.toBe(
      rateLimitSubject(new Headers({ "x-forwarded-for": "198.51.100.9" })),
    );
  });

  it("SEC-503 separates different discriminators on one client", () => {
    const headers = new Headers({ "x-forwarded-for": CLIENT_IP });

    expect(rateLimitSubject(headers, MEMBER_EMAIL)).not.toBe(
      rateLimitSubject(headers, "other@example.test"),
    );
    expect(rateLimitSubject(headers, MEMBER_EMAIL)).not.toBe(
      rateLimitSubject(headers),
    );
    expect(rateLimitSubject(headers, MEMBER_EMAIL)).toBe(
      rateLimitSubject(headers, MEMBER_EMAIL),
    );
  });

  it("SEC-504 uses the first hop of a proxy chain", () => {
    const chained = new Headers({
      "x-forwarded-for": `${CLIENT_IP}, 70.41.3.18, 150.172.238.178`,
    });
    const direct = new Headers({ "x-forwarded-for": CLIENT_IP });
    const spoofedTail = new Headers({
      "x-forwarded-for": `70.41.3.18, ${CLIENT_IP}`,
    });

    expect(rateLimitSubject(chained)).toBe(rateLimitSubject(direct));
    expect(rateLimitSubject(spoofedTail)).not.toBe(rateLimitSubject(direct));
  });

  it("SEC-505 still produces a stable subject when no address header is present", () => {
    const subject = rateLimitSubject(new Headers());

    expect(typeof subject).toBe("string");
    expect(subject.length).toBeGreaterThan(0);
    expect(subject).toBe(rateLimitSubject(new Headers()));
    expect(subject).not.toBe(
      rateLimitSubject(new Headers({ "x-forwarded-for": CLIENT_IP })),
    );
  });

  it("SEC-506 never carries the raw address or the raw email", () => {
    const headers = new Headers({
      "x-forwarded-for": `${CLIENT_IP}, 70.41.3.18`,
      "x-real-ip": CLIENT_IP,
    });

    for (const subject of [
      rateLimitSubject(headers),
      rateLimitSubject(headers, MEMBER_EMAIL),
      rateLimitSubject(new Headers({ "x-real-ip": CLIENT_IP }), MEMBER_EMAIL),
    ]) {
      expect(subject).not.toContain(CLIENT_IP);
      expect(subject).not.toContain("203.0.113");
      expect(subject).not.toContain(MEMBER_EMAIL);
      expect(subject).not.toContain("member");
      expect(subject).not.toContain("example.test");
      expect(subject).not.toContain("@");
    }
  });
});

describe("GH-14 rate-limit consumption (F3)", () => {
  it.each(BUCKETS)(
    "SEC-507 sends %s with a configured positive limit and window",
    async (bucket) => {
      await consumeRateLimit(bucket, SUBJECT);

      const [name] = mocks.rpc.mock.calls.at(-1)!;
      expect(String(name)).toMatch(/consume_rate_limit/);

      const args = lastRpcArgs();
      const values = Object.values(args);
      expect(values).toContain(bucket);
      expect(values).toContain(SUBJECT);

      const numbers = values.filter(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value),
      );
      expect(
        numbers.length,
        `${bucket} must carry a limit and a window`,
      ).toBeGreaterThanOrEqual(2);
      expect(numbers.every((value) => value > 0)).toBe(true);
    },
  );

  it("SEC-508 sends no raw client identity to the database", async () => {
    await consumeRateLimit(
      "sign_in",
      rateLimitSubject(
        new Headers({ "x-forwarded-for": CLIENT_IP }),
        MEMBER_EMAIL,
      ),
    );

    const serialized = JSON.stringify(lastRpcArgs());
    expect(serialized).not.toContain(CLIENT_IP);
    expect(serialized).not.toContain(MEMBER_EMAIL);
  });

  it.each([
    ["a single object", ALLOWED_ROW],
    ["a single-row array", [ALLOWED_ROW]],
  ])("SEC-509 maps %s to the verdict", async (_shape, data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });

    await expect(consumeRateLimit("sign_in", SUBJECT)).resolves.toEqual({
      allowed: true,
      remaining: 4,
      retryAfterSeconds: 30,
    });
  });

  it("SEC-510 maps an exhausted window to a denial with a retry delay", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: 45,
        retry_after_seconds: 45,
      },
      error: null,
    });

    await expect(consumeRateLimit("plaid_webhook", SUBJECT)).resolves.toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 45,
    });
  });
});

describe("GH-14 rate limiting fails closed (F3)", () => {
  it.each([
    [
      "the RPC returns an error",
      () =>
        mocks.rpc.mockResolvedValue({
          data: null,
          error: {
            code: "57014",
            message: "canceling statement due to statement timeout",
          },
        }),
    ],
    [
      "the RPC returns no row",
      () => mocks.rpc.mockResolvedValue({ data: null, error: null }),
    ],
    [
      "the RPC throws",
      () => mocks.rpc.mockRejectedValue(new Error("connection terminated")),
    ],
  ])("SEC-511 denies the attempt when %s", async (_case, arrange) => {
    arrange();

    const verdict = await consumeRateLimit("sign_in", SUBJECT);

    expect(verdict.allowed).toBe(false);
    expect(verdict.remaining).toBeLessThanOrEqual(0);
    expect(verdict.retryAfterSeconds).toBeGreaterThanOrEqual(0);
    // A closed verdict must not become an account-enumeration oracle or a
    // database-internals leak.
    expect(JSON.stringify(verdict)).not.toMatch(
      /statement timeout|connection terminated|57014/,
    );
  });

  it("SEC-512 denies rather than rejecting, so callers cannot fail open", async () => {
    mocks.rpc.mockRejectedValue(new Error("connection terminated"));

    await expect(
      consumeRateLimit("password_reset", SUBJECT),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("SEC-513 denies an empty-array result", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    await expect(
      consumeRateLimit("invitation_accept", SUBJECT),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("SEC-514 clears the budget for exactly one bucket and subject", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    await resetRateLimit("sign_in", SUBJECT);

    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("reset_rate_limit", {
      p_bucket: "sign_in",
      p_subject: SUBJECT,
    });
  });

  it("SEC-515 leaves the attempt counted when the reset cannot be recorded", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "offline" } });

    // Best-effort by design: a failed clear must not throw into the caller's
    // success path, and leaving the attempt counted is the safe direction.
    await expect(resetRateLimit("sign_in", SUBJECT)).resolves.toBeUndefined();
  });

  it("SEC-516 never leaks the raw subject or a database internal on reset failure", async () => {
    mocks.rpc.mockRejectedValue(
      new Error("connection terminated: sb_secret_leaked_value"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await resetRateLimit("password_confirm", SUBJECT);

    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      "sb_secret_leaked_value",
    );
    warn.mockRestore();
  });
});
