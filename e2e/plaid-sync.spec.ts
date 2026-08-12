import { expect, test, type Page, type TestInfo } from "@playwright/test";

const plaidE2eEnabled =
  process.env.PLAID_E2E_PROVIDER === "deterministic" &&
  process.env.PLAID_ENV === "sandbox";
const memberEmail = process.env.E2E_PLAID_MEMBER_EMAIL;
const memberPassword = process.env.E2E_PLAID_MEMBER_PASSWORD;
const repairFixtureEnabled = process.env.E2E_PLAID_REPAIR_STATE === "1";

function requireSyncFixture() {
  test.skip(
    !plaidE2eEnabled || !memberEmail || !memberPassword,
    "Requires deterministic Plaid Sandbox and an active member with an activated Item.",
  );
}

async function signIn(page: Page) {
  if (!memberEmail || !memberPassword) return;
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(memberEmail);
  await page.getByLabel("Password", { exact: true }).fill(memberPassword);
  await page.getByTestId("sign-in-submit").click();
  await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);
}

async function openAccounts(page: Page) {
  await signIn(page);
  await page.goto("/accounts");
  await expect(page.getByTestId("plaid-sync-status").first()).toBeVisible();
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ animations: "disabled", fullPage: true, path });
  await testInfo.attach(name, { contentType: "image/png", path });
}

test.describe("GH-5 Plaid transaction synchronization", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(() => requireSyncFixture());

  test("FE-001 Accounts renders stored freshness without calling Plaid or starting sync on page load", async ({
    page,
  }, testInfo) => {
    const forbiddenRequests: string[] = [];
    page.on("request", (request) => {
      if (
        /\/api\/plaid\/(?:sync|webhook)$/.test(
          new URL(request.url()).pathname,
        ) ||
        /transactions\/(?:sync|refresh)/i.test(request.url())
      ) {
        forbiddenRequests.push(`${request.method()} ${request.url()}`);
      }
    });

    await openAccounts(page);
    const status = page.getByTestId("plaid-sync-status").first();
    await expect(status).toContainText(
      /updated|waiting for the first update|checking|action needed/i,
    );
    expect(forbiddenRequests).toEqual([]);
    await capture(page, testInfo, "plaid-data-freshness");
  });

  test("FE-002 Check for updates calls the real member sync endpoint and announces success", async ({
    page,
  }) => {
    await openAccounts(page);
    const button = page.getByTestId("plaid-sync-check").first();
    const syncResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/plaid/sync") &&
        response.request().method() === "POST",
    );

    await button.click();
    await expect(button).toBeDisabled();
    expect((await syncResponse).status()).toBe(200);
    await expect(page.getByTestId("plaid-sync-feedback").first()).toContainText(
      /updated|current|complete|checked/i,
    );
    await expect(button).toBeEnabled();
  });

  test("FE-003 repair state stays actionable and never exposes Plaid internals", async ({
    page,
  }, testInfo) => {
    test.skip(
      !repairFixtureEnabled,
      "Requires E2E_PLAID_REPAIR_STATE=1 with the member Item seeded in login-repair or expiring-consent state.",
    );
    await openAccounts(page);
    const status = page.getByTestId("plaid-sync-status").first();
    await expect(status).toContainText(
      /reconnect|sign in again|renew|consent|permission/i,
    );
    await expect(status).not.toContainText(
      /ITEM_LOGIN_REQUIRED|access[-_ ]token|request_id|provider error/i,
    );
    await expect(page.getByTestId("plaid-connect")).toBeVisible();
    await capture(page, testInfo, "plaid-repair-state");
  });

  test("FE-004 freshness controls remain readable and keyboard-operable on mobile with reduced motion", async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await openAccounts(page);

    const button = page.getByTestId("plaid-sync-check").first();
    await button.focus();
    await expect(button).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("plaid-sync-status").first()).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await expect(
      page.getByTestId("plaid-sync-feedback").first(),
    ).toHaveAttribute("aria-live", "polite");
    await capture(page, testInfo, "plaid-sync-mobile-reduced-motion");
  });
});
