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
 * tab. These journeys retain the GH-9 identity while protecting that surface.
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

async function waitForTransactionsResponse(
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

async function waitForOverviewResponse(
  page: Page,
  action: () => Promise<void>,
) {
  const pending = page.waitForResponse(
    (response) =>
      response.url().includes("/api/dashboard/overview?") &&
      response.request().method() === "GET",
  );
  await action();
  const result = await pending;
  expect(result.status()).toBe(200);
  return result;
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

test.describe("GH-30 transaction exploration regression", () => {
  test("FE-002 previous, next, week, and custom period navigation refreshes real calendar ranges", async ({
    page,
  }, testInfo) => {
    requireDashboardFixture();
    await openTransactions(page);
    const before = await page.locator("main").textContent();
    await waitForTransactionsResponse(page, () =>
      page.getByTestId("transactions-previous-period").click(),
    );
    expect(await page.locator("main").textContent()).not.toBe(before);
    await waitForTransactionsResponse(page, () =>
      page.getByTestId("transactions-next-period").click(),
    );
    await expect(
      page.getByTestId("transactions-period-week"),
    ).toHaveAccessibleName(/monday|week/i);
    await waitForTransactionsResponse(page, () =>
      page.getByTestId("transactions-period-week").click(),
    );
    await page.getByTestId("transactions-period-custom").click();
    await page.getByTestId("transactions-custom-from").fill("2026-08-03");
    await page.getByTestId("transactions-custom-to").fill("2026-08-09");
    await waitForTransactionsResponse(page, () =>
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
    await waitForTransactionsResponse(page, async () => {
      await page.getByTestId("transactions-search").fill("a");
      await page.getByTestId("transactions-search").press("Enter");
    });
    const ledger = page.getByTestId("transactions-result-list");
    await expect(ledger).toContainText(/pending|no matching/i);
    if (
      (await ledger
        .locator(
          '[data-testid^="transactions-result-"]:not([data-testid="transactions-result-list"])',
        )
        .count()) > 0
    ) {
      await expect(ledger).toContainText(/plaid|manual|transfer|excluded/i);
    }
    await expect(
      page.getByTestId("transactions-summary-spending"),
    ).toBeVisible();
    await capture(page, testInfo, "transactions-filtered-ledger");
  });

  test("FE-006 mobile keyboard and reduced-motion use has no page overflow and keeps 44px exploration controls", async ({
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
    await expectNoHorizontalOverflow(page);
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

test.describe("GH-31 read-only month-to-date dashboard", () => {
  test("FE-006 is overflow-safe at 390, 768, and 1280px with visible mobile budget health, 44px scope targets, reduced motion, and a real scope refresh", async ({
    page,
  }, testInfo) => {
    requireDashboardFixture();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await openDashboard(page);

    const budget = page.getByTestId("dashboard-budget-health");
    await expect(budget).toBeVisible();
    await expect(budget).toBeInViewport();
    const initialViewport = page.viewportSize();
    expect(initialViewport).toEqual({ width: 390, height: 844 });
    for (const id of [
      "dashboard-budget-spent",
      "dashboard-budget-target",
      "dashboard-budget-remaining",
      "dashboard-budget-days",
    ]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, `${id} must be laid out at 390 px`).not.toBeNull();
      expect(
        box!.x,
        `${id} must start inside the initial viewport`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        box!.y,
        `${id} must start inside the initial viewport`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        box!.x + box!.width,
        `${id} must end inside the initial viewport width`,
      ).toBeLessThanOrEqual(initialViewport!.width);
      expect(
        box!.y + box!.height,
        `${id} must end inside the initial viewport height`,
      ).toBeLessThanOrEqual(initialViewport!.height);
    }
    for (const id of ["dashboard-scope-family", "dashboard-scope-personal"]) {
      const control = page.getByTestId(id);
      await expect(control).toHaveAccessibleName(/.+/);
      const box = await control.boundingBox();
      expect(box, `${id} must be laid out at 390 px`).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalOverflow(page);
    await expect(page.getByTestId("dashboard-comparison-chart")).toBeVisible();
    await expect(page.getByTestId("dashboard-comparison-table")).toBeVisible();
    await capture(page, testInfo, "dashboard-family-390-reduced-motion");

    const response = await waitForOverviewResponse(page, () =>
      page.getByTestId("dashboard-scope-personal").click(),
    );
    expect(new URL(response.url()).searchParams.get("scope")).toBe("personal");
    await expect(page.getByTestId("dashboard-scope-personal")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: /combined/i })).toHaveCount(
      0,
    );

    for (const viewport of [
      { name: "phone", width: 390, height: 844 },
      { name: "tablet", width: 768, height: 1024 },
      { name: "desktop", width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      await expectNoHorizontalOverflow(page);
      await expect(page.getByTestId("dashboard-budget-health")).toBeVisible();
      await expect(
        page.getByTestId("dashboard-comparison-chart"),
      ).toBeVisible();
      const table = page.getByTestId("dashboard-comparison-table");
      await expect(table).toBeVisible();
      await expect(table.getByRole("row").first()).toContainText(/day|date/i);
      await capture(
        page,
        testInfo,
        `dashboard-personal-${viewport.name}-reduced-motion`,
      );
    }
  });
});
