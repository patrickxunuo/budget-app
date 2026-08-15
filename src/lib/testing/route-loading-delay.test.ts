import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { delayRouteForE2E } from "./route-loading-delay";

const eligibleEnvironment = {
  APP_URL: "http://127.0.0.1:3100",
  CI: "true",
  E2E_ROUTE_LOADING_DELAY_MS: "2500",
  E2E_SERVER_MODE: "start",
  PLAID_E2E_PROVIDER: "deterministic",
};

describe("route-loading E2E delay", () => {
  it("waits only for the loopback production-mode E2E harness", async () => {
    const wait = vi.fn(async () => undefined);

    await delayRouteForE2E(eligibleEnvironment, wait);

    expect(wait).toHaveBeenCalledExactlyOnceWith(2500);
  });

  it.each([
    { CI: undefined },
    { E2E_SERVER_MODE: "dev" },
    { PLAID_E2E_PROVIDER: undefined },
    { APP_URL: "https://budget.example.test" },
    { VERCEL: "1" },
    { VERCEL_ENV: "preview" },
  ])("stays disabled outside that harness: %o", async (override) => {
    const wait = vi.fn(async () => undefined);

    await delayRouteForE2E({ ...eligibleEnvironment, ...override }, wait);

    expect(wait).not.toHaveBeenCalled();
  });

  it.each(["0", "5001", "1.5", "not-a-number"])(
    "rejects an unsafe enabled delay of %s",
    async (delay) => {
      await expect(
        delayRouteForE2E({
          ...eligibleEnvironment,
          E2E_ROUTE_LOADING_DELAY_MS: delay,
        }),
      ).rejects.toThrow(
        "E2E_ROUTE_LOADING_DELAY_MS must be an integer from 1 to 5000",
      );
    },
  );
});
