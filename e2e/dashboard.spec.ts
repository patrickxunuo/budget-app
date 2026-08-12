import { expect, test, type Page, type TestInfo } from "@playwright/test";

const memberEmail =
  process.env.E2E_DASHBOARD_MEMBER_EMAIL ?? process.env.E2E_PLAID_MEMBER_EMAIL;
const memberPassword =
  process.env.E2E_DASHBOARD_MEMBER_PASSWORD ??
  process.env.E2E_PLAID_MEMBER_PASSWORD;

function requireDashboardFixture() {
  test.skip(
    !memberEmail || !memberPassword,
    "Requires an active member with Family and Personal dashboard fixtures via E2E_DASHBOARD_MEMBER_* credentials.",
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

async function openDashboard(page: Page) {
  await signIn(page);
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-scope-family")).toBeVisible();
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

  test("FE-002 previous, next, week, and custom period navigation refreshes real calendar ranges", async ({
    page,
  }, testInfo) => {
    requireDashboardFixture();
    await openDashboard(page);
    const before = await page.locator("main").textContent();
    await waitForDashboardResponse(page, () =>
      page.getByTestId("dashboard-previous-period").click(),
    );
    expect(await page.locator("main").textContent()).not.toBe(before);
    await waitForDashboardResponse(page, () =>
      page.getByTestId("dashboard-next-period").click(),
    );
    await expect(
      page.getByTestId("dashboard-period-week"),
    ).toHaveAccessibleName(/monday|week/i);
    await waitForDashboardResponse(page, () =>
      page.getByTestId("dashboard-period-week").click(),
    );
    await page.getByTestId("dashboard-period-custom").click();
    await page.getByLabel(/^from$/i).fill("2026-08-03");
    await page.getByLabel(/^to$/i).fill("2026-08-09");
    await waitForDashboardResponse(page, () =>
      page.getByRole("button", { name: /apply|show custom/i }).click(),
    );
    await expect(page.locator("main")).toContainText(
      /Aug(?:ust)? 3|2026-08-03/i,
    );
    await expect(page.locator("main")).toContainText(
      /Aug(?:ust)? 9|2026-08-09/i,
    );
    await capture(page, testInfo, "dashboard-custom-range");
  });

  test("FE-003 combined real filters keep rows and totals aligned with visible semantic labels", async ({
    page,
  }, testInfo) => {
    requireDashboardFixture();
    await openDashboard(page);
    const account = page.getByTestId("dashboard-account-filter");
    const category = page.getByTestId("dashboard-category-filter");
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
    await page.getByTestId("dashboard-status-filter").selectOption("pending");
    await page.getByTestId("dashboard-inclusion-filter").selectOption("all");
    await waitForDashboardResponse(page, async () => {
      await page.getByTestId("dashboard-search").fill("a");
      await page.getByTestId("dashboard-search").press("Enter");
    });
    const ledger = page.getByTestId("dashboard-transaction-list");
    await expect(ledger).toContainText(/pending|no matching/i);
    if (
      (await ledger
        .locator('[data-testid^="dashboard-transaction-"]')
        .count()) > 0
    )
      await expect(ledger).toContainText(/plaid|manual|transfer|excluded/i);
    await expect(page.getByTestId("dashboard-summary-spending")).toBeVisible();
    await capture(page, testInfo, "dashboard-filtered-ledger");
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

  test("FE-006 mobile keyboard and reduced-motion use has no page overflow and captures the responsive dashboard", async ({
    page,
  }, testInfo) => {
    requireDashboardFixture();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await openDashboard(page);
    const family = page.getByTestId("dashboard-scope-family");
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
      "dashboard-search",
      "dashboard-account-filter",
      "dashboard-category-filter",
      "dashboard-status-filter",
      "dashboard-inclusion-filter",
    ])
      await expect(page.getByTestId(id)).toHaveAccessibleName(/.+/);
    await capture(page, testInfo, "dashboard-mobile-reduced-motion");
  });
});
