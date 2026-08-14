import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;

/**
 * Which server the suite drives. `start` is the lighter production server and
 * stays the default under CI, where memory headroom is the usual constraint.
 *
 * `E2E_SERVER_MODE=dev` exists for the deterministic Plaid journeys. The
 * client-side guard in src/components/plaid/plaid-link-flow.tsx is a
 * compile-time `NODE_ENV !== "production"` check — deliberately so, because it
 * stops a forged link-token response from pushing a real member down the fake
 * provider path — and `next start` runs as NODE_ENV=production. The journeys
 * are therefore unreachable against a production build by design, and the only
 * honest way to run them is against `next dev`. This is a harness choice; it
 * weakens no product control.
 */
const serverMode = (process.env.E2E_SERVER_MODE ??
  (process.env.CI ? "start" : "dev")) as "dev" | "start";

export default defineConfig({
  testDir: "./e2e",
  // Prints the fixture inventory once at end of run and fails when a family
  // named in E2E_REQUIRED_FIXTURES was never provisioned, so a skipped suite
  // can no longer read as a passing one.
  globalTeardown: "./e2e/support/global-teardown.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  outputDir: "test-results",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: `pnpm ${serverMode} --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
