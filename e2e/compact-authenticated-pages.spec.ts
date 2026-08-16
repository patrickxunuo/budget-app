import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { fixtureCredentials, requireFixture } from "./support/fixtures";

const credentials = fixtureCredentials("dashboard");

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

const ROUTES = [
  {
    path: "/dashboard",
    name: "Overview",
    primary: "dashboard-budget-health",
  },
  {
    path: "/transactions",
    name: "Transactions",
    primary: "transactions-explorer",
  },
  { path: "/budgets", name: "Budgets", primary: "budget-month" },
  { path: "/accounts", name: "Accounts", primary: "plaid-connections" },
  {
    path: "/categories",
    name: "Categories",
    primary: "category-workbench",
  },
  {
    path: "/settings/members",
    name: "Family members",
    primary: "membership-list",
  },
] as const;

const REMOVED_EDITORIAL =
  /Accounts \/ secure custody|Open the connection dossier|Ledger \/ connected & in hand|Every dollar has a margin|Monthly allocation ledger|Set the line\. Watch the month answer|Classification \/ household index|Give every dollar a place|Settings \/ membership register|The household roll|Financial field note|at a glance|working margin|Cumulative field trace|Balance observations/i;

async function signIn(page: Page) {
  if (!credentials) return;
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByTestId("sign-in-submit").click();
  await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function expectOneRouteHeading(page: Page, name: string) {
  const headings = page.locator("h1:visible");
  await expect(headings).toHaveCount(1);
  await expect(headings).toHaveText(name);
  await expect(page.getByTestId("route-heading")).toHaveCount(1);
  await expect(page.getByTestId("route-heading")).toHaveText(name);
}

async function expectPrimaryEntersViewport(
  primary: Locator,
  viewportHeight: number,
) {
  await expect(primary).toBeVisible();
  const box = await primary.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeLessThan(viewportHeight);
}

async function captureViewport(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path,
  });
  await testInfo.attach(name, { contentType: "image/png", path });
}

test.describe("GH-51 compact authenticated pages", () => {
  test.beforeEach(async ({ page }) => {
    requireFixture("dashboard");
    await signIn(page);
  });

  test("FE-003/FE-004 Overview leads with direct facts in the required narrow and wide order", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");

    const context = page.getByTestId("dashboard-heading");
    const budget = page.getByTestId("dashboard-budget-health");
    const accounts = page.getByTestId("dashboard-account-list");
    const spending = page.getByTestId("dashboard-comparison-chart");
    await expect(context).toContainText(/Family/i);
    await expect(context).toContainText(/[A-Z][a-z]+ 20\d{2}/);
    await expect(budget.getByRole("heading", { name: "Budget" })).toBeVisible();
    await expect(
      accounts.getByRole("heading", { name: "Accounts" }),
    ).toBeVisible();
    await expect(
      spending.getByRole("heading", { name: "Spending history" }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText(REMOVED_EDITORIAL);

    const narrowOrder = await page
      .locator(
        '[data-testid="dashboard-budget-health"], [data-testid="dashboard-account-list"], [data-testid="dashboard-comparison-chart"]',
      )
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-testid")),
      );
    expect(narrowOrder).toEqual([
      "dashboard-budget-health",
      "dashboard-account-list",
      "dashboard-comparison-chart",
    ]);

    await page.setViewportSize({ width: 1280, height: 800 });
    const spendingBox = await spending.boundingBox();
    const accountsBox = await accounts.boundingBox();
    expect(spendingBox).not.toBeNull();
    expect(accountsBox).not.toBeNull();
    expect(Math.abs(spendingBox!.y - accountsBox!.y)).toBeLessThanOrEqual(2);
    expect(spendingBox!.x).toBeLessThan(accountsBox!.x);
    expect(spendingBox!.width).toBeGreaterThan(0);
    expect(accountsBox!.width).toBeGreaterThan(0);
  });

  test("FE-005 View daily values is a keyboard-native narrow disclosure while the chart remains visible", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");

    const chart = page.getByTestId("dashboard-comparison-chart");
    const disclosure = page.getByTestId("dashboard-daily-values-disclosure");
    const summary = disclosure.locator("summary", {
      hasText: "View daily values",
    });
    const table = page.getByTestId("dashboard-comparison-table");
    await expect(chart).toBeVisible();
    await expect(summary).toBeVisible();
    await expect(table).not.toBeVisible();

    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(table).toBeVisible();
    await expect(
      table.getByRole("columnheader", { name: "Day" }),
    ).toBeVisible();
    await expect(
      table.getByRole("columnheader", { name: "Current" }),
    ).toBeVisible();
    await expect(
      table.getByRole("columnheader", { name: "Baseline" }),
    ).toBeVisible();
    await expect(table.getByRole("rowheader").first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(table).not.toBeVisible();
    await expect(chart).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(summary).not.toBeVisible();
    await expect(table).toBeVisible();
    await expect(page.getByTestId("dashboard-comparison-table")).toHaveCount(1);
  });

  for (const viewport of VIEWPORTS) {
    test(`FE-006 all six routes have one direct heading, immediate work, and no overflow at ${viewport.width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });

      for (const route of ROUTES) {
        await page.goto(route.path);
        await expectOneRouteHeading(page, route.name);
        const main = page.locator("main#main-content");
        await expect(main).toHaveCount(1);
        await expect(main).not.toContainText(REMOVED_EDITORIAL);
        await expectPrimaryEntersViewport(
          page.getByTestId(route.primary),
          viewport.height,
        );
        await expectNoHorizontalOverflow(page);
      }
    });
  }

  test("FE-007 Overview keeps all essential facts above the mobile navigation and attaches phone and desktop captures", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");

    await expect(page.getByTestId("dashboard-heading")).toContainText(
      /[A-Z][a-z]+ 20\d{2}/,
    );
    await expect(page.getByTestId("dashboard-heading")).toContainText(
      /Family/i,
    );
    await expect(page.getByTestId("dashboard-budget-spent")).toContainText(
      /\$250\.00/,
    );
    await expect(page.getByTestId("dashboard-budget-target")).toContainText(
      /\$1,000\.00/,
    );
    await expect(page.getByTestId("dashboard-budget-remaining")).toContainText(
      /\$750\.00/,
    );
    await expect(page.getByTestId("dashboard-budget-pace")).not.toHaveAttribute(
      "data-pace",
      "unavailable",
    );
    await expect(page.getByTestId("dashboard-budget-days")).toContainText(
      /Day \d+ of \d+/i,
    );

    const navigation = page.getByTestId("mobile-bottom-nav");
    await expect(navigation).toBeVisible();
    const navigationBox = await navigation.boundingBox();
    expect(navigationBox).not.toBeNull();
    for (const id of [
      "dashboard-heading",
      "dashboard-scope-family",
      "dashboard-scope-personal",
      "dashboard-budget-spent",
      "dashboard-budget-target",
      "dashboard-budget-remaining",
      "dashboard-budget-pace",
      "dashboard-budget-days",
    ]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(
        box,
        `${id} must be laid out in the first phone viewport`,
      ).not.toBeNull();
      expect(
        box!.y + box!.height,
        `${id} must end above the bottom navigation`,
      ).toBeLessThanOrEqual(navigationBox!.y);
    }
    await expectNoHorizontalOverflow(page);
    await captureViewport(page, testInfo, "overview-390x844");

    await page.setViewportSize({ width: 1280, height: 800 });
    await expectOneRouteHeading(page, "Overview");
    await expectNoHorizontalOverflow(page);
    await captureViewport(page, testInfo, "overview-1280x800");
  });

  test("FE-008 a nested route loading fallback updates the persistent route bar without a duplicate heading", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");

    const header = page.getByTestId("workspace-header");
    await header.evaluate((element) =>
      element.setAttribute("data-gh51-shell-probe", "mounted"),
    );
    const accountMenu = header.getByRole("button", { name: /account/i });
    await accountMenu.click();
    const membersLink = header.getByRole("link", {
      name: /family|member|household/i,
    });
    await membersLink.click();

    const skeleton = page.getByTestId("route-skeleton");
    await expect(skeleton).toBeVisible();
    await expect(header).toHaveAttribute("data-gh51-shell-probe", "mounted");
    await expectOneRouteHeading(page, "Family members");
    await expect(skeleton.locator("h1")).toHaveCount(0);
    await expect(skeleton.getByRole("status")).toHaveCount(1);
    await expect(skeleton).toHaveAttribute("id", "main-content");
    await expect(skeleton).toHaveAttribute("aria-busy", "true");

    await expect(page).toHaveURL(/\/settings\/members(?:\?.*)?$/);
    await expect(skeleton).toHaveCount(0, { timeout: 30_000 });
    await expect(header).toHaveAttribute("data-gh51-shell-probe", "mounted");
    await expectOneRouteHeading(page, "Family members");
  });
});
