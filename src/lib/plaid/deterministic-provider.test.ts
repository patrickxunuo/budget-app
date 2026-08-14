// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/plaid/client", () => ({ getPlaidClient: () => ({}) }));

const env = vi.hoisted(() => ({
  current: {} as Record<string, string | undefined>,
}));
vi.mock("@/lib/env/server", () => ({ getServerEnv: () => env.current }));

const sandboxLoopback = {
  APP_URL: "http://127.0.0.1:3100",
  PLAID_ENV: "sandbox",
  PLAID_E2E_PROVIDER: "deterministic",
};

/**
 * The provider is memoized in a module-level binding, so every case needs a
 * fresh module registry or the first verdict would decide all the others.
 */
async function resolveProvider(
  serverEnv: Record<string, string | undefined>,
  processEnv: Record<string, string | undefined> = {},
) {
  env.current = serverEnv;
  for (const [key, value] of Object.entries(processEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  const { getPlaidProvider } = await import("./provider");
  return getPlaidProvider();
}

const RESTRICTED = /restricted to local sandbox E2E runs/;
const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("GH-14 PROV deterministic Plaid provider admission", () => {
  it("PROV-001 serves the deterministic adapter on loopback Sandbox", async () => {
    await expect(resolveProvider(sandboxLoopback)).resolves.toBeDefined();
  });

  it.each(["localhost", "127.0.0.1", "::1"])(
    "PROV-002 accepts %s as a loopback host",
    async (hostname) => {
      const url =
        hostname === "::1" ? "http://[::1]:3100" : `http://${hostname}:3100`;
      await expect(
        resolveProvider({ ...sandboxLoopback, APP_URL: url }),
      ).resolves.toBeDefined();
    },
  );

  it("PROV-003 serves it under a production build on loopback", async () => {
    // The regression this locks: `next start` is NODE_ENV=production even on a
    // developer's machine and in CI, and the guard used to refuse on that
    // alone. It made the deterministic browser journeys unrunnable against a
    // production build — which is exactly how CI runs Playwright — while
    // protecting nothing, because a real deployment cannot be loopback.
    await expect(
      resolveProvider(sandboxLoopback, { NODE_ENV: "production" }),
    ).resolves.toBeDefined();
  });

  it.each([
    ["a non-loopback origin", { APP_URL: "https://budget.example.test" }],
    ["a non-Sandbox Plaid environment", { PLAID_ENV: "production" }],
    ["Plaid Trial", { PLAID_ENV: "trial" }],
  ])("PROV-004 refuses on %s", async (_label, override) => {
    await expect(
      resolveProvider({ ...sandboxLoopback, ...override }),
    ).rejects.toThrow(RESTRICTED);
  });

  it.each([
    [
      "a Vercel production deployment",
      { VERCEL: "1", VERCEL_ENV: "production" },
    ],
    ["a Vercel preview deployment", { VERCEL: "1", VERCEL_ENV: "preview" }],
    ["any Vercel environment", { VERCEL: "1" }],
  ])(
    "PROV-005 refuses on %s even when the rest looks local",
    async (_label, processEnv) => {
      // Stricter than the old VERCEL_ENV === "production" test, which admitted
      // preview deployments.
      await expect(
        resolveProvider(sandboxLoopback, processEnv),
      ).rejects.toThrow(RESTRICTED);
    },
  );

  it("PROV-006 falls through to the real SDK provider when the toggle is unset", async () => {
    const provider = await resolveProvider({
      APP_URL: "https://budget.example.test",
      PLAID_ENV: "production",
    });

    // No deterministic marker: the adapter is a toggle, never an addition.
    expect(provider.constructor.name).not.toMatch(/Deterministic/);
  });
});
