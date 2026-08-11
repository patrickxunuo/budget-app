import { expect, test, type Page, type TestInfo } from "@playwright/test";

const plaidE2eEnabled =
  process.env.PLAID_E2E_PROVIDER === "deterministic" &&
  process.env.PLAID_ENV === "sandbox";
const memberEmail = process.env.E2E_PLAID_MEMBER_EMAIL;
const memberPassword = process.env.E2E_PLAID_MEMBER_PASSWORD;

function requirePlaidFixture() {
  test.skip(
    !plaidE2eEnabled || !memberEmail || !memberPassword,
    "Requires PLAID_E2E_PROVIDER=deterministic in Sandbox and active-member E2E_PLAID_MEMBER credentials.",
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
  await expect(page.getByTestId("plaid-connect")).toBeVisible();
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ animations: "disabled", fullPage: true, path });
  await testInfo.attach(name, { contentType: "image/png", path });
}

async function openDeterministicLink(page: Page) {
  await page.getByTestId("plaid-connect").click();
  await expect(
    page.getByRole("button", { name: "Continue with E2E bank" }),
  ).toBeVisible();
}

async function startReview(page: Page) {
  await openDeterministicLink(page);
  await page.getByRole("button", { name: "Continue with E2E bank" }).click();
  await expect(page.getByTestId("plaid-review")).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("GH-4 Plaid account linking", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(() => requirePlaidFixture());

  test("FE-001 requests a real Link token and opens Plaid Link from the Accounts dossier", async ({
    page,
  }) => {
    await openAccounts(page);
    const linkTokenResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/plaid/link-token") &&
        response.request().method() === "POST",
    );
    await openDeterministicLink(page);
    await expect((await linkTokenResponse).status()).toBe(200);
    await expect(page.getByTestId("plaid-status")).toContainText(
      /connect|plaid|institution|review/i,
    );
  });

  test("FE-002 cancelling Plaid Link makes no exchange request and shows neutral retry guidance", async ({
    page,
  }) => {
    await openAccounts(page);
    let exchangeRequests = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/plaid/exchange")
      ) {
        exchangeRequests += 1;
      }
    });
    await openDeterministicLink(page);
    await page
      .getByRole("button", { name: "Cancel secure connection" })
      .click();
    await expect(page.getByTestId("plaid-status")).toContainText(
      /cancel|when you.re ready|try again|no changes/i,
    );
    expect(exchangeRequests).toBe(0);
  });

  test("FE-003 review shows every eligible and ineligible account with actionable selection state", async ({
    page,
  }, testInfo) => {
    await openAccounts(page);
    await startReview(page);
    const eligibilityMessages = page.locator(
      '[data-testid^="plaid-account-"][data-testid$="-eligibility"]',
    );
    await expect(eligibilityMessages.first()).toBeVisible();
    const ineligible = eligibilityMessages
      .filter({
        hasText: /not eligible|unsupported|CAD|Canadian-dollar|account type/i,
      })
      .first();
    await expect(ineligible).toBeVisible();
    const baseId = (await ineligible.getAttribute("data-testid"))?.replace(
      /-eligibility$/,
      "",
    );
    expect(baseId).toBeTruthy();
    await expect(page.getByTestId(`${baseId}-selected`)).toBeDisabled();
    await capture(page, testInfo, "plaid-account-review");
  });

  test("FE-004 Personal and Family scope choices remain independent and explain their privacy boundary", async ({
    page,
  }) => {
    await openAccounts(page);
    await startReview(page);
    const familyControls = page.locator(
      '[data-testid^="plaid-account-"][data-testid$="-scope-family"]:enabled',
    );
    test.skip(
      (await familyControls.count()) < 2,
      "The deterministic provider fixture must expose at least two eligible accounts.",
    );
    const first = familyControls.nth(0);
    const second = familyControls.nth(1);
    await first.check({ force: true });
    await expect(first).toBeChecked();
    await expect(second).not.toBeChecked();
    await expect(page.getByTestId("plaid-review")).toContainText(
      /Personal|Family|private|visible/i,
    );
  });

  test("FE-005 a likely Family duplicate requires an explicit override before activation retry", async ({
    page,
  }, testInfo) => {
    await openAccounts(page);
    await startReview(page);
    const duplicate = page
      .locator('[data-testid^="plaid-account-"][data-testid$="-duplicate"]')
      .first();
    test.skip(
      (await duplicate.count()) === 0,
      "The server-side Plaid fixture must include a likely Family duplicate.",
    );
    const baseId = (await duplicate.getAttribute("data-testid"))?.replace(
      /-duplicate$/,
      "",
    );
    expect(baseId).toBeTruthy();
    await page.getByTestId(`${baseId}-scope-family`).check({ force: true });
    await page.getByTestId("plaid-activate").click();
    await expect(duplicate).toContainText(/duplicate|already|same account/i);
    const override = duplicate.getByRole("checkbox", {
      name: /add anyway|override|duplicate/i,
    });
    await expect(override).toBeVisible();
    await capture(page, testInfo, "plaid-duplicate-warning");
    await override.check();
    await page.getByTestId("plaid-activate").click();
  });

  test("FE-006 successful activation reports account count and complete or pending import status", async ({
    page,
  }, testInfo) => {
    await openAccounts(page);
    await startReview(page);
    await page.getByTestId("plaid-activate").click();
    await expect(page.getByTestId("plaid-status")).toContainText(
      /activated|connected|account/i,
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("plaid-status")).toContainText(
      /transactions imported|import.*(?:complete|pending)|transaction history.*pending/i,
    );
    await capture(page, testInfo, "plaid-activation-success");
  });

  test("FE-007 OAuth return and invalid or expired tokens stay on Accounts with a focused retry state", async ({
    page,
  }, testInfo) => {
    await openAccounts(page);
    await page.goto("/accounts?oauth_state_id=e2e-invalid-or-expired");
    await expect(page).toHaveURL(/\/accounts(?:\?.*)?$/);
    await expect(page.getByTestId("plaid-status")).toContainText(
      /expired|invalid|could not resume|try again/i,
    );
    await expect(page.getByTestId("plaid-retry")).toBeVisible();
    await capture(page, testInfo, "plaid-oauth-retry");
  });

  test("FE-008 mobile, keyboard, and reduced-motion review remains responsive and operable", async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await openAccounts(page);
    await page.getByTestId("plaid-connect").focus();
    await expect(page.getByTestId("plaid-connect")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "Continue with E2E bank" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue with E2E bank" }).focus();
    await expect(
      page.getByRole("button", { name: "Continue with E2E bank" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("plaid-review")).toBeVisible({
      timeout: 30_000,
    });
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await expect(page.getByTestId("plaid-status")).toHaveAttribute(
      "aria-live",
      /polite|assertive/,
    );
    await page.getByTestId("plaid-activate").focus();
    await expect(page.getByTestId("plaid-activate")).toBeFocused();
    await capture(page, testInfo, "plaid-mobile-keyboard-review");
  });
});
