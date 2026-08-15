import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { fixtureCredentials, requireFixture } from "./support/fixtures";

const credentials = fixtureCredentials("dashboard");

function requireDashboardFixture() {
  requireFixture("dashboard");
}

async function signIn(page: Page) {
  if (!credentials) return;
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByTestId("sign-in-submit").click();
  await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);
}

async function openDashboard(page: Page) {
  await signIn(page);
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-scope-family")).toBeVisible();
}

/**
 * GH-30 moved exploration and export off `/dashboard` and onto the Transactions
 * tab. The journeys below that exercise period navigation, composed filters and
 * the 390 px surface are the same GH-9 acceptance criteria — only the surface
 * they run against moved, so they keep their GH-9 identity and describe block.
 */
async function openTransactions(page: Page, query = "") {
  await signIn(page);
  await page.goto(`/transactions${query}`);
  await expect(page.getByTestId("transactions-scope-family")).toBeVisible();
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ animations: "disabled", fullPage: true, path });
  await testInfo.attach(name, { contentType: "image/png", path });
}

async function waitForDashboardResponse(
  page: Page,
  action: () => Promise<void>,
) {
  const pending = page.waitForResponse(
    (response) =>
      response.url().includes("/api/dashboard?") &&
      response.request().method() === "GET",
  );
  await action();
  const result = await pending;
  expect(result.status()).toBe(200);
}

test.describe("GH-9 Family and Personal financial dashboards", () => {
  test("FE-001 Family and Personal scopes replace the complete real dashboard and never offer Combined", async ({
    page,
  }, testInfo) => {
    requireDashboardFixture();
    await openDashboard(page);
    await expect(page.getByRole("button", { name: /combined/i })).toHaveCount(
      0,
    );
    await capture(page, testInfo, "dashboard-family-desktop");
    await waitForDashboardResponse(page, () =>
      page.getByTestId("dashboard-scope-personal").click(),
    );
    await expect(page.getByTestId("dashboard-scope-personal")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const id of [
      "dashboard-summary-income",
      "dashboard-cash-flow-chart",
      "dashboard-category-list",
      "dashboard-budget-list",
      "dashboard-account-list",
      "dashboard-transaction-list",
    ])
      await expect(page.getByTestId(id)).toBeVisible();
    await capture(page, testInfo, "dashboard-personal-desktop");
  });

  // Re-pointed to /transactions by GH-30: the exploration controls now live on
  // the Transactions tab. Still a GH-9 criterion, still the same behaviour.
  test("FE-002 previous, next, week, and custom period navigation refreshes real calendar ranges", async ({
    page,
  }, testInfo) => {
    requireDashboardFixture();
    await openTransactions(page);
    const before = await page.locator("main").textContent();
    await waitForDashboardResponse(page, () =>
      page.getByTestId("transactions-previous-period").click(),
    );
    expect(await page.locator("main").textContent()).not.toBe(before);
    await waitForDashboardResponse(page, () =>
      page.getByTestId("transactions-next-period").click(),
    );
    await expect(
      page.getByTestId("transactions-period-week"),
    ).toHaveAccessibleName(/monday|week/i);
    await waitForDashboardResponse(page, () =>
      page.getByTestId("transactions-period-week").click(),
    );
    await page.getByTestId("transactions-period-custom").click();
    await page.getByTestId("transactions-custom-from").fill("2026-08-03");
    await page.getByTestId("transactions-custom-to").fill("2026-08-09");
    await waitForDashboardResponse(page, () =>
      page.getByTestId("transactions-custom-apply").click(),
    );
    await expect(page.getByTestId("transactions-range-label")).toContainText(
      /Aug(?:ust)? 3|2026-08-03/i,
    );
    await expect(page.getByTestId("transactions-range-label")).toContainText(
      /Aug(?:ust)? 9|2026-08-09/i,
    );
    await capture(page, testInfo, "transactions-custom-range");
  });

  // Re-pointed to /transactions by GH-30; see the note on FE-002.
  test("FE-003 combined real filters keep rows and totals aligned with visible semantic labels", async ({
    page,
  }, testInfo) => {
    requireDashboardFixture();
    await openTransactions(page);
    const account = page.getByTestId("transactions-account-filter");
    const category = page.getByTestId("transactions-category-filter");
    const accountValue = await account
      .locator("option[value]:not([value=''])")
      .first()
      .getAttribute("value");
    const categoryValue = await category
      .locator("option[value]:not([value=''])")
      .first()
      .getAttribute("value");
    test.skip(
      !accountValue || !categoryValue,
      "Requires visible account and category fixtures.",
    );
    await account.selectOption(accountValue!);
    await category.selectOption(categoryValue!);
    await page
      .getByTestId("transactions-status-filter")
      .selectOption("pending");
    await page.getByTestId("transactions-inclusion-filter").selectOption("all");
    await waitForDashboardResponse(page, async () => {
      await page.getByTestId("transactions-search").fill("a");
      await page.getByTestId("transactions-search").press("Enter");
    });
    const ledger = page.getByTestId("transactions-result-list");
    await expect(ledger).toContainText(/pending|no matching/i);
    // `transactions-result-list` shares the row prefix, so it is excluded here.
    if (
      (await ledger
        .locator(
          '[data-testid^="transactions-result-"]:not([data-testid="transactions-result-list"])',
        )
        .count()) > 0
    )
      await expect(ledger).toContainText(/plaid|manual|transfer|excluded/i);
    await expect(
      page.getByTestId("transactions-summary-spending"),
    ).toBeVisible();
    await capture(page, testInfo, "transactions-filtered-ledger");
  });

  test("FE-004 summaries, chart fallback, budget progress, balances, and freshness are readable without colour", async ({
    page,
  }, testInfo) => {
    requireDashboardFixture();
    await openDashboard(page);
    for (const id of [
      "dashboard-summary-income",
      "dashboard-summary-spending",
      "dashboard-summary-net",
      "dashboard-summary-pending",
    ])
      await expect(page.getByTestId(id)).toContainText(/\$|CAD/);
    await expect(
      page.getByTestId("dashboard-cash-flow-chart").getByRole("table"),
    ).toBeVisible();
    await expect(page.getByTestId("dashboard-budget-list")).toContainText(
      /budget|%|no budget/i,
    );
    await expect(page.getByTestId("dashboard-account-list")).toContainText(
      /available|unavailable|updated|fresh/i,
    );
    await capture(page, testInfo, "dashboard-financial-field-report");
  });

  test("FE-005 a real failed refresh is announced while the last successful dashboard remains usable", async ({
    page,
  }, testInfo) => {
    requireDashboardFixture();
    await openDashboard(page);
    const successfulSummary = await page
      .getByTestId("dashboard-summary-income")
      .textContent();
    await page.context().setOffline(true);
    await page.getByTestId("dashboard-scope-personal").click();
    const error = page.getByTestId("dashboard-error");
    await expect(error).toHaveAttribute("role", "alert");
    await expect(error).toContainText(/try again|retry|connection|refresh/i);
    await expect(page.getByTestId("dashboard-summary-income")).toHaveText(
      successfulSummary ?? "",
    );
    await page.context().setOffline(false);
    await capture(page, testInfo, "dashboard-refresh-error-preserves-data");
  });

  // Re-pointed to /transactions by GH-30; see the note on FE-002. The 44 px
  // target check comes from the acceptance doc's responsive section.
  test("FE-006 mobile keyboard and reduced-motion use has no page overflow and captures the responsive dashboard", async ({
    page,
  }, testInfo) => {
    requireDashboardFixture();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await openTransactions(page);
    const family = page.getByTestId("transactions-scope-family");
    await family.focus();
    await expect(family).toBeFocused();
    await page.keyboard.press("Tab");
    const activeName = await page.locator(":focus").getAttribute("aria-label");
    const activeText = await page.locator(":focus").textContent();
    expect(`${activeName ?? ""}${activeText ?? ""}`.trim()).not.toBe("");
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    for (const id of [
      "transactions-scope-family",
      "transactions-scope-personal",
      "transactions-period-day",
      "transactions-period-week",
      "transactions-period-month",
      "transactions-period-custom",
      "transactions-previous-period",
      "transactions-next-period",
      "transactions-search",
      "transactions-account-filter",
      "transactions-category-filter",
      "transactions-status-filter",
      "transactions-inclusion-filter",
    ]) {
      const control = page.getByTestId(id);
      await expect(control).toHaveAccessibleName(/.+/);
      const box = await control.boundingBox();
      expect(box, `${id} must be laid out at 390 px`).not.toBeNull();
      expect(
        Math.min(box!.width, box!.height),
        `${id} must be at least 44 px on its smallest side`,
      ).toBeGreaterThanOrEqual(44);
    }
    // The controls sit above the ledger rather than overlaying it.
    const controls = await page
      .getByTestId("transactions-search")
      .boundingBox();
    const ledger = await page
      .getByTestId("transactions-result-list")
      .boundingBox();
    expect(controls!.y + controls!.height).toBeLessThanOrEqual(ledger!.y + 1);
    await capture(page, testInfo, "transactions-mobile-reduced-motion");
  });
});
