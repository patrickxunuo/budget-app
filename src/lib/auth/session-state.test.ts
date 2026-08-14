// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const store = vi.hoisted(() => ({
  jar: new Map<string, { name: string; value: string }>(),
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  getAll: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => store }));
vi.mock("@/lib/env/server", () => ({
  getServerEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key" }),
}));

import {
  ABSOLUTE_SESSION_SECONDS,
  RECENT_CONFIRMATION_COOKIE,
  RECOVERY_FLOW_COOKIE,
  SESSION_START_COOKIE,
  clearApplicationAuthCookies,
  consumeRecoveryFlow,
  createRecoveryCallbackState,
  establishRecoveryFlow,
  establishSessionStart,
  markRecentConfirmationCookie,
  verifyRecoveryCallbackState,
  verifyState,
} from "./session-state";

const userId = "10000000-0000-4000-8000-000000000001";
const otherUserId = "10000000-0000-4000-8000-000000000002";
const now = new Date("2026-08-14T12:00:00.000Z");

/** The value the module would have written for `userId` at `secondsAgo`. */
async function issuedAt(secondsAgo: number, purpose: "session" | "recovery") {
  vi.setSystemTime(new Date(now.getTime() - secondsAgo * 1000));
  const establish =
    purpose === "session" ? establishSessionStart : establishRecoveryFlow;
  await establish(userId);
  const written = store.set.mock.lastCall?.[1] as string;
  vi.setSystemTime(now);
  return written;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.jar.clear();
  store.set.mockImplementation((name: string, value: string) => {
    store.jar.set(name, { name, value });
  });
  store.get.mockImplementation((name: string) => store.jar.get(name));
  store.delete.mockImplementation((name: string) => store.jar.delete(name));
  store.getAll.mockImplementation(() => [...store.jar.values()]);
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GH-14 SESSION signed absolute-session and recovery state", () => {
  it("SESSION-001 accepts a freshly issued session cookie for its own user", async () => {
    const value = await issuedAt(0, "session");

    expect(
      verifyState(value, userId, "session", ABSOLUTE_SESSION_SECONDS),
    ).toBe(true);
  });

  it("SESSION-002 enforces the 30-day absolute session policy at the boundary", async () => {
    const oneSecondInside = await issuedAt(
      ABSOLUTE_SESSION_SECONDS - 1,
      "session",
    );
    const exactlyAtLimit = await issuedAt(ABSOLUTE_SESSION_SECONDS, "session");
    const oneSecondPast = await issuedAt(
      ABSOLUTE_SESSION_SECONDS + 1,
      "session",
    );

    expect(ABSOLUTE_SESSION_SECONDS).toBe(30 * 24 * 60 * 60);
    expect(
      verifyState(oneSecondInside, userId, "session", ABSOLUTE_SESSION_SECONDS),
    ).toBe(true);
    expect(
      verifyState(exactlyAtLimit, userId, "session", ABSOLUTE_SESSION_SECONDS),
    ).toBe(true);
    // A session that has outlived the absolute policy cannot be renewed by
    // re-presenting it; the proxy signs the member out on exactly this verdict.
    expect(
      verifyState(oneSecondPast, userId, "session", ABSOLUTE_SESSION_SECONDS),
    ).toBe(false);
  });

  it("SESSION-003 rejects a cookie bound to a different Auth user", async () => {
    const value = await issuedAt(0, "session");

    expect(
      verifyState(value, otherUserId, "session", ABSOLUTE_SESSION_SECONDS),
    ).toBe(false);
  });

  it("SESSION-004 rejects a cookie issued for a different purpose", async () => {
    const recovery = await issuedAt(0, "recovery");

    // Purpose is inside the HMAC, so a short-lived recovery cookie cannot be
    // replayed as a 30-day session cookie.
    expect(
      verifyState(recovery, userId, "session", ABSOLUTE_SESSION_SECONDS),
    ).toBe(false);
    expect(verifyState(recovery, userId, "recovery", 600)).toBe(true);
  });

  it("SESSION-005 rejects tampered, malformed, empty, and future-dated values", async () => {
    const value = await issuedAt(0, "session");
    const [id, ts, sig = ""] = value.split(".");

    expect(
      verifyState(undefined, userId, "session", ABSOLUTE_SESSION_SECONDS),
    ).toBe(false);
    expect(verifyState("", userId, "session", ABSOLUTE_SESSION_SECONDS)).toBe(
      false,
    );
    expect(
      verifyState(`${id}.${ts}`, userId, "session", ABSOLUTE_SESSION_SECONDS),
    ).toBe(false);
    expect(
      verifyState(
        `${id}.${ts}.${sig}.extra`,
        userId,
        "session",
        ABSOLUTE_SESSION_SECONDS,
      ),
    ).toBe(false);
    expect(
      verifyState(
        `${id}.${ts}.${sig.slice(0, -1)}x`,
        userId,
        "session",
        ABSOLUTE_SESSION_SECONDS,
      ),
    ).toBe(false);
    expect(
      verifyState(
        `${id}.not-a-number.${sig}`,
        userId,
        "session",
        ABSOLUTE_SESSION_SECONDS,
      ),
    ).toBe(false);
    // Backdating the clock forward would otherwise mint an eternally valid
    // cookie, so a negative age is rejected outright.
    const future = await issuedAt(-60, "session");
    expect(
      verifyState(future, userId, "session", ABSOLUTE_SESSION_SECONDS),
    ).toBe(false);
  });

  it("SESSION-006 issues auth cookies as HttpOnly, SameSite=Lax, path-scoped", async () => {
    await establishSessionStart(userId);
    await establishRecoveryFlow(userId);
    await markRecentConfirmationCookie(userId);

    for (const call of store.set.mock.calls) {
      expect(call[2]).toMatchObject({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
      expect(call[2].maxAge).toBeGreaterThan(0);
    }
    expect(store.set.mock.calls.map(([name]) => name as string).sort()).toEqual(
      [
        RECENT_CONFIRMATION_COOKIE,
        RECOVERY_FLOW_COOKIE,
        SESSION_START_COOKIE,
      ].sort(),
    );
  });

  it("SESSION-007 consumes the recovery flow exactly once", async () => {
    await establishRecoveryFlow(userId);

    expect(await consumeRecoveryFlow(userId)).toBe(true);
    // Single-use: the cookie is deleted on consumption, so a replayed reset
    // attempt finds nothing to verify.
    expect(store.jar.has(RECOVERY_FLOW_COOKIE)).toBe(false);
    expect(await consumeRecoveryFlow(userId)).toBe(false);
  });

  it("SESSION-008 clears the recovery flow even when it did not verify", async () => {
    await establishRecoveryFlow(userId);

    expect(await consumeRecoveryFlow(otherUserId)).toBe(false);
    expect(store.jar.has(RECOVERY_FLOW_COOKIE)).toBe(false);
  });

  it("SESSION-009 accepts a recovery callback only for its own address inside the window", () => {
    const state = createRecoveryCallbackState("Member@Example.COM");

    expect(verifyRecoveryCallbackState(state, "member@example.com")).toBe(true);
    // Case is normalized on both sides, so a differently-cased sign-in address
    // still matches the address the link was minted for.
    expect(verifyRecoveryCallbackState(state, "MEMBER@EXAMPLE.COM")).toBe(true);
    expect(verifyRecoveryCallbackState(state, "someone@example.com")).toBe(
      false,
    );
    expect(verifyRecoveryCallbackState(state, undefined)).toBe(false);
    expect(verifyRecoveryCallbackState(null, "member@example.com")).toBe(false);
  });

  it("SESSION-010 expires a recovery callback after ten minutes", () => {
    const state = createRecoveryCallbackState("member@example.com");

    vi.setSystemTime(new Date(now.getTime() + 9 * 60_000));
    expect(verifyRecoveryCallbackState(state, "member@example.com")).toBe(true);
    vi.setSystemTime(new Date(now.getTime() + 10 * 60_000 + 1_000));
    expect(verifyRecoveryCallbackState(state, "member@example.com")).toBe(
      false,
    );
  });

  it("SESSION-011 rejects a recovery callback whose payload was rewritten", () => {
    const state = createRecoveryCallbackState("member@example.com");
    const signaturePart = state.slice(state.lastIndexOf(".") + 1);
    const forged = Buffer.from(
      JSON.stringify({
        email: "attacker@example.com",
        issuedAt: Math.floor(now.getTime() / 1000),
      }),
    ).toString("base64url");

    // Re-using a valid signature over a different payload must not verify, and
    // neither must a payload that is not decodable JSON.
    expect(
      verifyRecoveryCallbackState(
        `${forged}.${signaturePart}`,
        "attacker@example.com",
      ),
    ).toBe(false);
    expect(
      verifyRecoveryCallbackState("not-base64.$$$", "member@example.com"),
    ).toBe(false);
    expect(verifyRecoveryCallbackState("nodots", "member@example.com")).toBe(
      false,
    );
  });

  it("SESSION-012 clears every Supabase and application auth cookie on sign-out", async () => {
    store.jar.set("sb-access-token", {
      name: "sb-access-token",
      value: "token",
    });
    store.jar.set("sb-refresh-token", {
      name: "sb-refresh-token",
      value: "token",
    });
    store.jar.set("unrelated-preference", {
      name: "unrelated-preference",
      value: "keep",
    });
    await establishSessionStart(userId);
    await establishRecoveryFlow(userId);
    await markRecentConfirmationCookie(userId);

    await clearApplicationAuthCookies();

    expect([...store.jar.keys()]).toEqual(["unrelated-preference"]);
  });
});
