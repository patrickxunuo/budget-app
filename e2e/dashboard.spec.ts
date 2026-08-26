import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { fixtureCredentials, requireFixture } from "./support/fixtures";
import { chooseFirstSelectOption, chooseSelectOption } from "./support/select";

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
  return result;
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
    await chooseFirstSelectOption(account);
    await chooseFirstSelectOption(category);
    await chooseSelectOption(
      page.getByTestId("transactions-status-filter"),
      "Pending",
      "pending",
    );
    await chooseSelectOption(
      page.getByTestId("transactions-inclusion-filter"),
      "All lines",
      "all",
    );
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
    const categoryMenuTrigger = page.getByTestId(
      "transactions-category-filter",
    );
    await categoryMenuTrigger.click();
    const menu = page.locator(".piggy-select-menu");
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(390);
    expect(
      await menu.evaluate((element) => ({
        animationName: getComputedStyle(element).animationName,
        overflowsHorizontally: element.scrollWidth > element.clientWidth,
      })),
    ).toEqual({ animationName: "none", overflowsHorizontally: false });
    await capture(page, testInfo, "transactions-mobile-category-select-open");
    await page.keyboard.press("Escape");
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
  test("FE-003 renders exact seeded month-to-date budget figures, balances, and freshness from the real backend", async ({
    page,
  }, testInfo) => {
    requireDashboardFixture();
    await openDashboard(page);

    await expect(page.getByTestId("dashboard-budget-health")).toBeVisible();
    await expect(page.getByTestId("dashboard-budget-spent")).toHaveText(
      /\$250\.00/,
    );
    await expect(page.getByTestId("dashboard-budget-target")).toHaveText(
      /\$1,000\.00/,
    );
    await expect(page.getByTestId("dashboard-budget-remaining")).toHaveText(
      /\$750\.00/,
    );

    const accounts = page.getByTestId("dashboard-account-list");
    const availableAccount = accounts
      .locator("article")
      .filter({ hasText: "E2E Family Chequing" });
    await expect(availableAccount).toHaveCount(1);
    await expect(availableAccount).toContainText(/Available\s*\$2,456\.78/);
    await expect(availableAccount).toContainText(/Current\s*\$2,500\.00/);
    await expect(availableAccount).toContainText(/Updated\s+/);
    await expect(availableAccount).not.toContainText(/Freshness unavailable/i);

    await expect(page.getByTestId("dashboard-baseline-note")).toContainText(
      /history is unavailable/i,
    );
    await capture(page, testInfo, "dashboard-seeded-month-to-date");
  });

  test("FE-004 renders the seeded null-balance account as Unavailable, never zero", async ({
    page,
  }, testInfo) => {
    requireDashboardFixture();
    await openDashboard(page);

    const unavailableAccount = page
      .getByTestId("dashboard-account-list")
      .locator("article")
      .filter({ hasText: "E2E Family Unavailable" });
    await expect(unavailableAccount).toHaveCount(1);
    await expect(unavailableAccount).toContainText(/Available\s*Unavailable/i);
    await expect(unavailableAccount).toContainText(/Current\s*Unavailable/i);
    await expect(unavailableAccount).toContainText(/Freshness unavailable/i);
    await expect(unavailableAccount).not.toContainText(/\$0\.00/);
    await capture(page, testInfo, "dashboard-null-balance-unavailable");
  });
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
    await expect(
      page.getByTestId("dashboard-daily-values-disclosure"),
    ).toBeVisible();
    await expect(
      page.getByTestId("dashboard-comparison-table"),
    ).not.toBeVisible();
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
      const disclosure = page.getByTestId("dashboard-daily-values-disclosure");
      const table = page.getByTestId("dashboard-comparison-table");
      if (viewport.width >= 1024) {
        await expect(disclosure.locator("summary")).not.toBeVisible();
        await expect(table).toBeVisible();
        await expect(table.getByRole("row").first()).toContainText(/day|date/i);
      } else {
        await expect(disclosure).toBeVisible();
        await expect(table).not.toBeVisible();
      }
      await capture(
        page,
        testInfo,
        `dashboard-personal-${viewport.name}-reduced-motion`,
      );
    }
  });
});
test.describe("GH-63 spending-history interactive readings", () => {
  test("FE-001 FE-003 FE-005 FE-006 FE-008 expose real axes, mouse and keyboard readings, and preserve the complete daily table", async ({
    page,
  }, testInfo) => {
    requireDashboardFixture();
    await page.setViewportSize({ width: 1280, height: 900 });
    await openDashboard(page);

    await expect(
      page.getByTestId("dashboard-comparison-x-axis-title"),
    ).toHaveText("Day of month");
    await expect(
      page.getByTestId("dashboard-comparison-y-axis-title"),
    ).toHaveText("Cumulative spending (CAD)");
    const xTicks = page.getByTestId("dashboard-comparison-x-tick");
    await expect(xTicks.first()).toHaveText("1");
    await expect(xTicks.last()).not.toHaveText("");
    const availableDays = await page
      .getByTestId("dashboard-comparison-table")
      .getByRole("rowheader")
      .count();
    await expect(xTicks).toHaveCount(Math.min(6, availableDays));
    await expect(
      page.getByTestId("dashboard-comparison-y-tick").filter({ hasText: "$0" }),
    ).toHaveCount(1);

    const plot = page.getByTestId("dashboard-comparison-plot");
    await expect(plot).toHaveAccessibleName(/spending history|inspect/i);
    const box = await plot.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width - 2, box!.y + box!.height / 2);
    const tooltip = page.getByTestId("dashboard-comparison-tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(/This month/i);
    await expect(tooltip).not.toContainText(/good|bad|red|green/i);
    const guide = page.getByTestId("dashboard-comparison-guide");
    await expect(guide).toHaveCount(1);
    const guideX = await guide.getAttribute("x1");
    expect(guideX).not.toBeNull();
    await expect(guide).toHaveAttribute("x2", guideX!);
    await expect(
      page.getByTestId("dashboard-comparison-active-current-marker"),
    ).toBeVisible();
    await expect(
      page.getByTestId("dashboard-comparison-active-baseline-marker"),
    ).toHaveCount(0);
    await expect(tooltip).not.toContainText(
      /baseline|above|below|at baseline/i,
    );
    await page.mouse.move(1, 1);
    await expect(tooltip).toHaveCount(0);

    await plot.focus();
    await expect(plot).toBeFocused();
    await expect(tooltip).toBeVisible();
    const reading = page.getByTestId("dashboard-comparison-reading");
    await expect(reading).toHaveAttribute("role", "status");
    await expect(reading).toHaveAttribute("aria-live", "polite");
    await expect(reading).not.toHaveText("");
    await plot.press("ArrowLeft");
    await expect(reading).not.toHaveText("");
    await plot.press("Escape");
    await expect(tooltip).toHaveCount(0);
    await expect(reading).toHaveText("");

    const disclosure = page.getByTestId("dashboard-daily-values-disclosure");
    const table = page.getByTestId("dashboard-comparison-table");
    await expect(disclosure.locator("summary")).not.toBeVisible();
    await expect(table).toBeVisible();
    expect(await table.getByRole("row").count()).toBeGreaterThan(1);
    await expect(
      table.getByRole("columnheader", { name: "Day" }),
    ).toBeVisible();
    await expect(
      table.getByRole("columnheader", { name: "Current" }),
    ).toBeVisible();
    await expect(
      table.getByRole("columnheader", { name: "Baseline" }),
    ).toBeVisible();
    await expect(xTicks.last()).toHaveText(
      await table.getByRole("rowheader").last().innerText(),
    );
    await capture(page, testInfo, "dashboard-spending-history-reading-desktop");
  });

  test("FE-001 FE-004 keeps narrow axes readable and pins a touch reading until an outside interaction", async ({
    page,
  }, testInfo) => {
    requireDashboardFixture();
    await page.setViewportSize({ width: 390, height: 844 });
    await openDashboard(page);

    const xTicks = page.getByTestId("dashboard-comparison-x-tick");
    expect(await xTicks.count()).toBeGreaterThanOrEqual(3);
    expect(await xTicks.count()).toBeLessThanOrEqual(4);
    const plot = page.getByTestId("dashboard-comparison-plot");
    const box = await plot.boundingBox();
    expect(box).not.toBeNull();
    await plot.dispatchEvent("pointerdown", {
      pointerType: "touch",
      clientX: box!.x + box!.width - 2,
      clientY: box!.y + box!.height / 2,
      bubbles: true,
    });
    const tooltip = page.getByTestId("dashboard-comparison-tooltip");
    await expect(tooltip).toBeVisible();
    const firstReading = await tooltip.textContent();
    await plot.dispatchEvent("pointerleave", {
      pointerType: "touch",
      bubbles: true,
    });
    await expect(tooltip).toBeVisible();
    await plot.dispatchEvent("pointerdown", {
      pointerType: "touch",
      clientX: box!.x + 1,
      clientY: box!.y + box!.height / 2,
      bubbles: true,
    });
    await expect(tooltip).not.toHaveText(firstReading ?? "");
    await page.locator("body").dispatchEvent("pointerdown", {
      pointerType: "touch",
      clientX: box!.x + 1,
      clientY: 1,
      bubbles: true,
    });
    await expect(tooltip).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await capture(page, testInfo, "dashboard-spending-history-touch-mobile");
  });
});

test.describe("GH-65 complete cursor pagination", () => {
  test("FE-001 FE-002 FE-003 FE-009 progressively reveals the real mobile ledger and requests only at cursor exhaustion", async ({
    page,
  }, testInfo) => {
    requireDashboardFixture();
    await page.setViewportSize({ width: 390, height: 844 });
    let dashboardRequests = 0;
    page.on("request", (request) => {
      if (
        request.method() === "GET" &&
        request.url().includes("/api/dashboard?")
      ) {
        dashboardRequests += 1;
      }
    });
    await openTransactions(page);

    const rows = page.locator(
      '[data-testid^="transactions-result-"]:not([data-testid="transactions-result-list"])',
    );
    const visibleCount = page.getByTestId("transactions-visible-count");
    const countText = (await visibleCount.textContent()) ?? "";
    const total = Number(countText.match(/of\s+(\d+)/i)?.[1] ?? 0);
    test.skip(
      total <= 50,
      "GH-65 browser acceptance requires a real dashboard fixture with more than 50 matching transactions.",
    );

    await expect(rows).toHaveCount(10);
    await expect(visibleCount).toContainText(`10 of ${total}`);
    const showMore = page.getByTestId("transactions-show-more");
    await expect(showMore).toHaveAccessibleName("Show 10 more");
    const box = await showMore.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    const initialRequestCount = dashboardRequests;
    await showMore.click();
    await expect(rows).toHaveCount(20);
    expect(dashboardRequests).toBe(initialRequestCount);

    await showMore.click();
    await showMore.click();
    await showMore.click();
    await expect(rows).toHaveCount(50);
    expect(dashboardRequests).toBe(initialRequestCount);

    await showMore.click();
    await expect.poll(() => dashboardRequests).toBe(initialRequestCount + 1);
    await expect(rows).toHaveCount(Math.min(60, total));
    const ids = await rows.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-testid")),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(page.url()).not.toMatch(/cursor|limit|visible|page=/i);
    const exportUrl = new URL(
      (await page.getByTestId("transactions-export-csv").getAttribute("href"))!,
      page.url(),
    );
    expect(exportUrl.pathname).toBe("/api/transactions/export");
    for (const key of ["cursor", "limit", "visible", "page"]) {
      expect(exportUrl.searchParams.has(key)).toBe(false);
    }
    await capture(page, testInfo, "transactions-cursor-pagination-mobile");
  });

  test("FE-004 renders up to 50 real rows initially on desktop with complete totals", async ({
    page,
  }, testInfo) => {
    requireDashboardFixture();
    await page.setViewportSize({ width: 1280, height: 900 });
    await openTransactions(page);

    const visibleCount = page.getByTestId("transactions-visible-count");
    const countText = (await visibleCount.textContent()) ?? "";
    const total = Number(countText.match(/of\s+(\d+)/i)?.[1] ?? 0);
    test.skip(
      total <= 50,
      "GH-65 browser acceptance requires a real dashboard fixture with more than 50 matching transactions.",
    );
    const rows = page.locator(
      '[data-testid^="transactions-result-"]:not([data-testid="transactions-result-list"])',
    );
    await expect(rows).toHaveCount(50);
    await expect(visibleCount).toContainText(`50 of ${total}`);
    await expect(
      page.getByTestId("transactions-summary-spending"),
    ).toBeVisible();
    await capture(page, testInfo, "transactions-cursor-pagination-desktop");
  });

  test("FE-005 FE-007 resets expanded pagination for a real filter change and plain Transactions navigation", async ({
    page,
  }) => {
    requireDashboardFixture();
    await page.setViewportSize({ width: 390, height: 844 });
    await openTransactions(page);
    const visibleCount = page.getByTestId("transactions-visible-count");
    const total = Number(
      ((await visibleCount.textContent()) ?? "").match(/of\s+(\d+)/i)?.[1] ?? 0,
    );
    test.skip(
      total <= 10,
      "GH-65 reset acceptance requires a real dashboard fixture with more than 10 matching transactions.",
    );

    await page.getByTestId("transactions-show-more").click();
    await expect(visibleCount).toHaveText(
      `${Math.min(20, total)} of ${total} transactions visible`,
    );
    const postedResponse = await waitForTransactionsResponse(page, () =>
      chooseSelectOption(
        page.getByTestId("transactions-status-filter"),
        "Posted",
        "posted",
      ),
    );
    const postedModel = (await postedResponse.json()) as {
      totalTransactionCount: number;
    };
    await expect(visibleCount).toHaveText(
      `${Math.min(10, postedModel.totalTransactionCount)} of ${postedModel.totalTransactionCount} transactions visible`,
    );
    expect(page.url()).not.toMatch(/cursor|limit|visible|page=/i);
    expect(page.url()).toContain("status=posted");

    const transactionsLink = page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: /transactions/i });
    await transactionsLink.click();
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(
      page.getByTestId("transactions-status-filter"),
    ).toHaveAttribute("data-value", "all");
    await expect(
      page.getByTestId("transactions-inclusion-filter"),
    ).toHaveAttribute("data-value", "default");
    await expect(page.getByTestId("transactions-scope-family")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("transactions-period-month")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(visibleCount).toHaveText(
      `${Math.min(10, total)} of ${total} transactions visible`,
    );

    const today = await page.evaluate(() => {
      const values = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Toronto",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        })
          .formatToParts(new Date())
          .map(({ type, value }) => [type, value]),
      );
      return `${values.year}-${values.month}-${values.day}`;
    });
    const exportUrl = new URL(
      (await page.getByTestId("transactions-export-csv").getAttribute("href"))!,
      page.url(),
    );
    expect(Object.fromEntries(exportUrl.searchParams)).toEqual({
      scope: "family",
      period: "month",
      reference: today,
      status: "all",
      inclusion: "default",
    });
  });
});
