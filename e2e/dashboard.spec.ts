import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
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

async function openAdvancedTransactionFilters(page: Page): Promise<Locator> {
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await page.getByTestId("transactions-filters-trigger").click();
    const sheet = page.getByTestId("transactions-filter-sheet");
    await expect(sheet).toBeVisible();
    return sheet;
  }
  return page.locator("main");
}

async function closeAdvancedTransactionFilters(page: Page) {
  if ((page.viewportSize()?.width ?? 0) >= 768) return;
  await page.getByTestId("transactions-filter-close").click();
  await expect(page.getByTestId("transactions-filter-sheet")).toBeHidden();
}

async function chooseTransactionPeriod(
  page: Page,
  period: "day" | "week" | "month" | "custom",
) {
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await chooseSelectOption(
      page.getByTestId("transactions-period-select-mobile"),
      period[0]!.toUpperCase() + period.slice(1),
      period,
    );
    return;
  }
  await page.getByTestId(`transactions-period-${period}`).click();
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
    const periodControl =
      (page.viewportSize()?.width ?? 0) < 768
        ? page.getByTestId("transactions-period-select-mobile")
        : page.getByTestId("transactions-period-week");
    await expect(periodControl).toHaveAccessibleName(/accounting period|week/i);
    await waitForTransactionsResponse(page, () =>
      chooseTransactionPeriod(page, "week"),
    );
    await chooseTransactionPeriod(page, "custom");
    const advancedFilters = await openAdvancedTransactionFilters(page);
    await advancedFilters
      .getByTestId("transactions-custom-from")
      .fill("2026-08-03");
    await advancedFilters
      .getByTestId("transactions-custom-to")
      .fill("2026-08-09");
    await waitForTransactionsResponse(page, () =>
      advancedFilters.getByTestId("transactions-custom-apply").click(),
    );
    await closeAdvancedTransactionFilters(page);
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
    const advancedFilters = await openAdvancedTransactionFilters(page);
    const account = advancedFilters.getByTestId("transactions-account-filter");
    const category = advancedFilters.getByTestId(
      "transactions-category-filter",
    );
    await waitForTransactionsResponse(page, async () => {
      await chooseFirstSelectOption(account);
    });
    await waitForTransactionsResponse(page, async () => {
      await chooseFirstSelectOption(category);
    });
    await waitForTransactionsResponse(page, () =>
      chooseSelectOption(
        advancedFilters.getByTestId("transactions-status-filter"),
        "Pending",
        "pending",
      ),
    );
    await waitForTransactionsResponse(page, () =>
      chooseSelectOption(
        advancedFilters.getByTestId("transactions-inclusion-filter"),
        "All lines",
        "all",
      ),
    );
    await closeAdvancedTransactionFilters(page);
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
    const mobileControls = [
      "transactions-scope-family",
      "transactions-scope-personal",
      "transactions-period-select-mobile",
      "transactions-previous-period",
      "transactions-next-period",
      "transactions-search",
      "transactions-filters-trigger",
    ];
    for (const id of mobileControls) {
      const control = page.getByTestId(id);
      await expect(control).toHaveAccessibleName(/.+/);
      const box = await control.boundingBox();
      expect(box, `${id} must be laid out at 390 px`).not.toBeNull();
      expect(
        box!.height,
        `${id} must be at least 44 px tall`,
      ).toBeGreaterThanOrEqual(44);
    }
    await page.getByTestId("transactions-filters-trigger").click();
    const filterSheet = page.getByTestId("transactions-filter-sheet");
    const categoryMenuTrigger = filterSheet.getByTestId(
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
      .locator('tbody th[scope="row"]')
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
    expect(
      await plot.evaluate((element) => getComputedStyle(element).userSelect),
    ).toBe("none");
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

  test("FE-005 FE-007 resets expanded pagination through the mobile filter sheet and plain Transactions navigation", async ({
    page,
  }) => {
    requireDashboardFixture();
    await page.setViewportSize({ width: 390, height: 844 });
    await openTransactions(page);
    const visibleCount = page.getByTestId("transactions-visible-count");
    const readTotal = async () =>
      Number(
        ((await visibleCount.textContent()) ?? "").match(/of\s+(\d+)/i)?.[1] ??
          0,
      );
    await expect.poll(readTotal).toBeGreaterThan(0);
    const defaultTotal = await readTotal();

    const filterTrigger = page.getByTestId("transactions-filters-trigger");
    await filterTrigger.click();
    const filterSheet = page.getByTestId("transactions-filter-sheet");
    const allLinesResponse = await waitForTransactionsResponse(page, () =>
      chooseSelectOption(
        filterSheet.getByTestId("transactions-inclusion-filter"),
        "All lines",
        "all",
      ),
    );
    const allLinesModel = (await allLinesResponse.json()) as {
      totalTransactionCount: number;
    };
    expect(allLinesModel.totalTransactionCount).toBeGreaterThan(10);
    await page.getByTestId("transactions-filter-close").click();
    await expect(visibleCount).toHaveText(
      `10 of ${allLinesModel.totalTransactionCount} transactions visible`,
    );

    const showMore = page.getByTestId("transactions-show-more");
    await expect(showMore).toBeVisible();
    await showMore.click();
    await expect(visibleCount).toHaveText(
      `${Math.min(20, allLinesModel.totalTransactionCount)} of ${allLinesModel.totalTransactionCount} transactions visible`,
    );

    await filterTrigger.click();
    const postedResponse = await waitForTransactionsResponse(page, () =>
      chooseSelectOption(
        filterSheet.getByTestId("transactions-status-filter"),
        "Posted",
        "posted",
      ),
    );
    const postedModel = (await postedResponse.json()) as {
      totalTransactionCount: number;
    };
    await page.getByTestId("transactions-filter-close").click();
    await expect(visibleCount).toHaveText(
      `${Math.min(10, postedModel.totalTransactionCount)} of ${postedModel.totalTransactionCount} transactions visible`,
    );
    expect(page.url()).not.toMatch(/cursor|limit|visible|page=/i);
    expect(page.url()).toContain("status=posted");
    expect(page.url()).toContain("inclusion=all");

    const transactionsLink = page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: /transactions/i });
    await transactionsLink.click();
    await expect(page).toHaveURL(/\/transactions$/);
    await filterTrigger.click();
    await expect(
      filterSheet.getByTestId("transactions-status-filter"),
    ).toHaveAttribute("data-value", "all");
    await expect(
      filterSheet.getByTestId("transactions-inclusion-filter"),
    ).toHaveAttribute("data-value", "default");
    await page.getByTestId("transactions-filter-close").click();
    await expect(page.getByTestId("transactions-scope-family")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      page.getByTestId("transactions-period-select-mobile"),
    ).toHaveAttribute("data-value", "month");
    await expect(visibleCount).toHaveText(
      `${Math.min(10, defaultTotal)} of ${defaultTotal} transactions visible`,
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

test.describe("GH-66 responsive transactions information-first", () => {
  test("FE-002 keeps the compact mobile filter and nested category list independently scrollable", async ({
    page,
  }, testInfo) => {
    requireDashboardFixture();
    await page.setViewportSize({ width: 390, height: 420 });
    await openTransactions(page);

    const controlsBox = await page
      .getByTestId("transactions-control-panel")
      .boundingBox();
    expect(controlsBox).not.toBeNull();
    expect(controlsBox!.height).toBeLessThanOrEqual(126);

    await chooseTransactionPeriod(page, "custom");
    await page.getByTestId("transactions-filters-trigger").click();

    const sheet = page.getByTestId("transactions-filter-sheet");
    const sheetBox = await sheet.boundingBox();
    expect(sheetBox).not.toBeNull();
    expect(sheetBox!.height).toBeLessThanOrEqual(254);

    const filterGrid = sheet.getByTestId("transactions-filter-grid");
    const filterPositions = await filterGrid
      .locator(":scope > label")
      .evaluateAll((labels) =>
        labels.map((label) => label.getBoundingClientRect().top),
      );
    expect(filterPositions).toHaveLength(4);
    expect(filterPositions[0]).toBe(filterPositions[1]);
    expect(filterPositions[2]).toBe(filterPositions[3]);
    expect(filterPositions[2]).toBeGreaterThan(filterPositions[0]!);

    const scrollRegion = sheet.getByTestId("transactions-filter-scroll-region");
    const sheetScroll = await scrollRegion.evaluate((element) => ({
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
    }));
    expect(sheetScroll.overflowY).toMatch(/auto|scroll/);
    expect(sheetScroll.scrollHeight).toBeGreaterThan(sheetScroll.clientHeight);
    await scrollRegion.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() => scrollRegion.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await scrollRegion.evaluate((element) => {
      element.scrollTop = 0;
    });

    const category = sheet.getByTestId("transactions-category-filter");
    await category.click();
    const categoryList = page
      .locator(".piggy-select-menu")
      .getByRole("listbox");
    await expect(categoryList).toBeVisible();
    const categoryScroll = await categoryList.evaluate((element) => ({
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
    }));
    expect(categoryScroll.overflowY).toMatch(/auto|scroll/);
    expect(categoryScroll.scrollHeight).toBeGreaterThan(
      categoryScroll.clientHeight,
    );
    await categoryList.evaluate((element) => {
      element.scrollTop = 0;
    });
    const categoryBox = await categoryList.boundingBox();
    expect(categoryBox).not.toBeNull();
    const touch = await page.context().newCDPSession(page);
    const touchX = categoryBox!.x + categoryBox!.width / 2;
    const touchStartY = categoryBox!.y + categoryBox!.height - 20;
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: touchX, y: touchStartY }],
    });
    for (const offset of [35, 70, 105]) {
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: touchX, y: touchStartY - offset }],
      });
    }
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(() => categoryList.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await capture(
      page,
      testInfo,
      "transactions-compact-scrollable-filters-mobile",
    );
  });

  test("FE-009 covers the deterministic real mobile hierarchy, filters, grouping, expansion, details, failure recovery, hidden actions, overflow, targets, and screenshots", async ({
    page,
    context,
  }, testInfo) => {
    requireDashboardFixture();
    await page.setViewportSize({ width: 390, height: 844 });
    await openTransactions(page);

    await expect(page.getByTestId("route-heading")).toBeVisible();
    await expect(page.getByTestId("route-heading")).toHaveText("Transactions");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(
      page.getByRole("heading", { level: 2, name: "Transaction activity" }),
    ).toBeAttached();
    const ordered = await page.locator("main").evaluate((main) => {
      const selectors = [
        '[data-testid="transactions-range-label"]',
        '[data-testid="transactions-visible-count"]',
        '[data-testid="transactions-scope-family"]',
        '[data-testid="transactions-summary-income"]',
        '[data-testid="transactions-period-select-mobile"]',
        '[data-testid="transactions-search"]',
        '[data-testid="transactions-filters-trigger"]',
        '[data-testid="transactions-result-list"]',
      ];
      return selectors.map((selector) => {
        const element = main.querySelector(selector);
        if (!element)
          throw new Error(`Missing mobile hierarchy element: ${selector}`);
        return (element as HTMLElement).offsetTop;
      });
    });
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
    for (const id of [
      "transactions-summary-income",
      "transactions-summary-spending",
      "transactions-summary-net",
      "transactions-summary-pending",
    ]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }

    const filtersTrigger = page.getByTestId("transactions-filters-trigger");
    await filtersTrigger.click();
    const sheet = page.getByTestId("transactions-filter-sheet");
    await expect(sheet).toHaveAttribute("role", "dialog");
    const category = sheet.getByTestId("transactions-category-filter");
    await category.click();
    const categoryMenu = page.locator(".piggy-select-menu");
    const categorySearch = categoryMenu.getByRole("combobox", {
      name: /search categories/i,
    });
    await expect(categorySearch).toBeFocused();
    await page.keyboard.press("Tab");
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(
            document.activeElement?.closest(
              '[data-testid="transactions-filter-sheet"], .piggy-select-menu',
            ),
          ),
        ),
      )
      .toBe(true);
    await page.keyboard.press("Shift+Tab");
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(
            document.activeElement?.closest(
              '[data-testid="transactions-filter-sheet"], .piggy-select-menu',
            ),
          ),
        ),
      )
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(categoryMenu).toBeHidden();
    await expect(sheet).toBeVisible();
    await expect(category).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(filtersTrigger).toBeFocused();

    await filtersTrigger.click();
    const allLinesResponse = waitForTransactionsResponse(page, () =>
      chooseSelectOption(
        sheet.getByTestId("transactions-inclusion-filter"),
        "All lines",
        "all",
      ),
    );
    await allLinesResponse;
    await page.getByTestId("transactions-filter-close").click();
    const inclusionChip = page.getByTestId(
      "transactions-filter-chip-inclusion",
    );
    await expect(inclusionChip).toContainText(/all lines/i);

    await waitForTransactionsResponse(page, () => inclusionChip.click());
    await expect(inclusionChip).toBeHidden();
    await filtersTrigger.click();
    await waitForTransactionsResponse(page, () =>
      chooseSelectOption(
        sheet.getByTestId("transactions-inclusion-filter"),
        "All lines",
        "all",
      ),
    );
    await page.getByTestId("transactions-filter-close").click();

    const rows = page.locator(
      '[data-testid^="transactions-result-"]:not([data-testid="transactions-result-list"])',
    );
    await expect(rows).toHaveCount(10);
    await expect
      .poll(async () => {
        const text =
          (await page
            .getByTestId("transactions-visible-count")
            .textContent()) ?? "";
        return Number(text.match(/of\s+(\d+)/i)?.[1] ?? 0);
      })
      .toBeGreaterThanOrEqual(23);
    await expect
      .poll(() =>
        page.locator('[data-testid^="transactions-date-group-"]').count(),
      )
      .toBeGreaterThanOrEqual(3);
    await expect(
      page.getByRole("button", { name: /GH-66 Ledger Merchant 01/i }),
    ).toContainText(/pending/i);
    await expect(
      page.getByRole("button", { name: /GH-66 Ledger Merchant 01/i }),
    ).toContainText(/excluded/i);
    await expect(
      page.getByRole("button", { name: /GH-66 Manual Cash Adjustment/i }),
    ).toContainText(/manual/i);

    const showMore = page.getByTestId("transactions-show-more");
    await expect(showMore).toBeVisible();
    await showMore.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => scrollY);
    await showMore.click();
    await expect(rows).toHaveCount(20);
    await expect(
      page.getByTestId("transactions-pagination-status"),
    ).toContainText(/20.*visible|showing.*20/i);
    expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);

    const fixtureRow = page.getByRole("button", { name: /E2E Grocer/i });
    await fixtureRow.click();
    const detail = page.getByTestId("transaction-detail-sheet");
    const metadata = page.getByTestId("transaction-detail-metadata");
    await expect(detail).toBeVisible();
    for (const value of [
      /250\.00/,
      /E2E Dashboard Grocery Purchase/i,
      /E2E Family Chequing/i,
      /Family/i,
      /Posted/i,
      /Spending/i,
      /Connected account/i,
      /FOOD_AND_DRINK_GROCERIES/i,
      /E2E Dashboard Groceries/i,
      /Included/i,
      /GH-66 complete metadata fixture/i,
    ]) {
      await expect(metadata).toContainText(value);
    }
    await expect(
      detail.getByRole("button", {
        name: /edit|delete|categor|export|manage/i,
      }),
    ).toHaveCount(0);
    await page.getByTestId("transaction-detail-close").click();
    await expect(fixtureRow).toBeFocused();

    await context.setOffline(true);
    await fixtureRow.click();
    await expect(page.getByTestId("transaction-detail-error")).toBeVisible();
    await context.setOffline(false);
    await page.getByTestId("transaction-detail-retry").click();
    await expect(metadata).toContainText(/GH-66 complete metadata fixture/i);
    await page.getByTestId("transaction-detail-close").click();

    await expect(page.getByTestId("transactions-export-csv")).toBeHidden();
    await expect(page.getByTestId("transactions-manage-menu")).toBeHidden();
    for (const control of [
      filtersTrigger,
      page.getByTestId("transactions-search"),
      page.getByTestId("transactions-period-select-mobile"),
      fixtureRow,
    ]) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalOverflow(page);
    await capture(page, testInfo, "transactions-information-first-mobile");
  });

  test("FE-009 retains deterministic desktop review, inline filters, Manage, CSV, grouping, detail, overflow, and screenshot", async ({
    page,
  }, testInfo) => {
    requireDashboardFixture();
    await page.setViewportSize({ width: 1280, height: 900 });
    await openTransactions(page);

    await expect(page.getByTestId("transactions-filters-trigger")).toBeHidden();
    for (const id of [
      "transactions-account-filter",
      "transactions-category-filter",
      "transactions-status-filter",
      "transactions-inclusion-filter",
      "transactions-manage-menu",
      "transactions-export-csv",
    ]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    await waitForTransactionsResponse(page, () =>
      chooseSelectOption(
        page.getByTestId("transactions-inclusion-filter"),
        "All lines",
        "all",
      ),
    );
    const rows = page.locator(
      '[data-testid^="transactions-result-"]:not([data-testid="transactions-result-list"])',
    );
    await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(23);
    await expect
      .poll(() =>
        page.locator('[data-testid^="transactions-date-group-"]').count(),
      )
      .toBeGreaterThanOrEqual(3);
    await page.getByRole("button", { name: /E2E Grocer/i }).click();
    await expect(page.getByTestId("transaction-detail-metadata")).toContainText(
      /GH-66 complete metadata fixture/i,
    );
    await page.getByTestId("transaction-detail-close").click();
    await expectNoHorizontalOverflow(page);
    await capture(page, testInfo, "transactions-information-first-desktop");
  });
});
