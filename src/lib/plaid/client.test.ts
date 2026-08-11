import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlaidEnvironments } from "plaid";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({ plaidEnv: "sandbox" }));

vi.mock("@/lib/env/server", () => ({
  getServerEnv: () => ({
    PLAID_ENV: state.plaidEnv,
    PLAID_CLIENT_ID: "server-client-id",
    PLAID_SECRET: "server-secret",
  }),
}));

beforeEach(() => {
  vi.resetModules();
  state.plaidEnv = "sandbox";
});

async function configuredClient() {
  const { getPlaidClient } = await import("./client");
  return getPlaidClient() as unknown as {
    basePath: string;
    configuration: {
      basePath: string;
      baseOptions: { headers: Record<string, string> };
    };
  };
}

describe("Plaid endpoint configuration", () => {
  it("maps Sandbox to Plaid's Sandbox endpoint with server-only credentials", async () => {
    const client = await configuredClient();

    expect(client.basePath).toBe(PlaidEnvironments.sandbox);
    expect(client.configuration.basePath).toBe(PlaidEnvironments.sandbox);
    expect(client.configuration.baseOptions.headers).toMatchObject({
      "PLAID-CLIENT-ID": "server-client-id",
      "PLAID-SECRET": "server-secret",
    });
  });

  it.each(["production", "trial"])(
    "maps %s to Plaid's Production endpoint",
    async (plaidEnv) => {
      state.plaidEnv = plaidEnv;

      const client = await configuredClient();

      expect(client.basePath).toBe(PlaidEnvironments.production);
      expect(client.configuration.basePath).toBe(PlaidEnvironments.production);
      expect(client.basePath).not.toBe(PlaidEnvironments.sandbox);
    },
  );
});
