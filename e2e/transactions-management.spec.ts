import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { fixtureCredentials, requireFixture } from "./support/fixtures";

const ownerCredentials = fixtureCredentials("auth-owner");
const dashboardCredentials = fixtureCredentials("dashboard");

function requireDashboardFixture() {
  requireFixture("dashboard");
}

async function signIn(
  page: Page,
  credentials: { email: string; password: string } | undefined,
) {
  if (!credentials) return;
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByTestId("sign-in-submit").click();
  await expect(page).toHaveURL(
    /\/(?:dashboard|transactions|categories)(?:\?.*)?$/,
  );
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ animations: "disabled", fullPage: true, path });
  await testInfo.attach(name, { contentType: "image/png", path });
}

async function setStableViewport(
  page: Page,
  viewport: { width: number; height: number },
) {
  await page.setViewportSize(viewport);
  await expect
    .poll(() => page.evaluate(() => window.innerWidth))
    .toBe(viewport.width);
}

async function openManageMenu(page: Page) {
  const menu = page.getByTestId("transactions-manage-menu");
  await expect(menu).toBeVisible();
  const trigger = menu.locator("summary");
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(menu).toHaveAttribute("open", "");
  await expect(menu.getByTestId("transactions-manage-manual")).toBeVisible();
  await expect(menu.getByTestId("transactions-manage-plaid")).toBeVisible();
  return menu;
}

const canonicalOverview =
  "/transactions?scope=personal&period=week&reference=2026-08-24&search=coffee&status=pending";

test.describe("GH-64 transaction management routes", () => {
  test("FE-001 FE-002 FE-003 FE-007 keeps the overview read-only and preserves canonical scope/filter return navigation", async ({
    page,
  }, testInfo) => {
    requireFixture("auth-owner");
    await signIn(page, ownerCredentials);
    await page.goto(canonicalOverview);
    await expect(page.getByTestId("transactions-explorer")).toBeVisible();
    await expect(page.getByTestId("manual-entry-workbench")).toHaveCount(0);
    await expect(page.getByTestId("transaction-ledger")).toHaveCount(0);
    await expect(page.getByTestId("manual-entry-form")).toHaveCount(0);
    await expect(page.getByTestId(/^category-save-/)).toHaveCount(0);

    const menu = await openManageMenu(page);
    const manualLink = menu.getByTestId("transactions-manage-manual");
    const plaidLink = menu.getByTestId("transactions-manage-plaid");
    for (const [link, pathname] of [
      [manualLink, "/transactions/manual"],
      [plaidLink, "/transactions/plaid"],
    ] as const) {
      const target = new URL(
        String(await link.getAttribute("href")),
        page.url(),
      );
      expect(target.pathname).toBe(pathname);
      expect(target.searchParams.get("scope")).toBe("personal");
      expect(target.searchParams.get("returnTo")).toBe(canonicalOverview);
    }
    await capture(page, testInfo, "transactions-read-only-manage-menu");

    await manualLink.click();
    await expect(page.getByTestId("manual-management-page")).toBeVisible();
    await expect(page.getByTestId("manual-entry-workbench")).toBeVisible();
    await expect(page.getByTestId("transaction-ledger")).toHaveCount(0);
    const manualBack = page.getByTestId("back-to-transactions");
    await expect(manualBack).toHaveAccessibleName("Back to Transactions");
    await expect(manualBack).toHaveAttribute("href", canonicalOverview);
    await capture(page, testInfo, "transactions-manual-management");

    await page.goBack();
    await expect(page).toHaveURL(
      new RegExp(`${canonicalOverview.replace(/[?&]/g, "\\$&")}$`),
    );
    await expect(page.getByTestId("transactions-explorer")).toBeVisible();

    const reopened = await openManageMenu(page);
    await reopened.getByTestId("transactions-manage-plaid").click();
    await expect(page.getByTestId("plaid-management-page")).toBeVisible();
    await expect(page.getByTestId("transaction-ledger")).toBeVisible();
    await expect(page.getByTestId("manual-entry-workbench")).toHaveCount(0);
    await expect(page.getByTestId("back-to-transactions")).toHaveAttribute(
      "href",
      canonicalOverview,
    );
    await capture(page, testInfo, "transactions-plaid-management");

    await page.goBack();
    await expect(page).toHaveURL(
      new RegExp(`${canonicalOverview.replace(/[?&]/g, "\\$&")}$`),
    );
  });

  test("FE-003 rejects external, protocol-relative, credential-bearing, and wrong-path return targets", async ({
    page,
  }) => {
    requireFixture("auth-owner");
    await signIn(page, ownerCredentials);
    for (const returnTo of [
      "https://evil.example/transactions",
      "//evil.example/transactions",
      "https://user:secret@evil.example/transactions",
      "/transactions/plaid",
      "/categories?scope=family",
    ]) {
      await page.goto(
        `/transactions/manual?scope=personal&returnTo=${encodeURIComponent(returnTo)}`,
      );
      await expect(page.getByTestId("back-to-transactions")).toHaveAttribute(
        "href",
        "/transactions?scope=personal",
      );
    }
  });

  test("FE-005 keeps Plaid categorization and merchant-rule controls on the dedicated route", async ({
    page,
  }) => {
    requireDashboardFixture();
    await signIn(page, dashboardCredentials);
    await page.goto("/transactions/plaid?scope=family");
    const ledger = page.getByTestId("transaction-ledger");
    await expect(ledger).toBeVisible();
    const rows = ledger.getByTestId(/^transaction-row-/);
    test.skip(
      (await rows.count()) === 0,
      "Dashboard fixture has no Plaid row.",
    );
    const firstRow = rows.first();
    await expect(firstRow.getByTestId(/^original-category-/)).toBeVisible();
    await expect(firstRow.getByTestId(/^effective-category-/)).toBeVisible();
    await expect(firstRow.getByTestId(/^category-select-/)).toBeVisible();
    await expect(firstRow.getByTestId(/^category-save-/)).toBeVisible();
    await expect(firstRow.getByTestId(/^rule-create-/)).toBeVisible();
  });

  test("FE-006 removes both CSV exports from mobile layout and accessibility, then exposes them at desktop width", async ({
    page,
  }, testInfo) => {
    requireFixture("auth-owner");
    await setStableViewport(page, { width: 390, height: 844 });
    await signIn(page, ownerCredentials);
    await page.goto("/transactions?scope=family&reference=2026-08-24");
    const overviewExport = page.getByTestId("transactions-export-csv");
    await expect(overviewExport).toBeHidden();
    expect(await overviewExport.boundingBox()).toBeNull();
    await expect(page.getByRole("link", { name: /export.*csv/i })).toHaveCount(
      0,
    );
    await capture(page, testInfo, "transactions-mobile-export-hidden");

    await setStableViewport(page, { width: 1024, height: 900 });
    await expect(overviewExport).toBeVisible();

    await setStableViewport(page, { width: 390, height: 844 });
    await page.goto("/transactions/manual?scope=family");
    const manualExport = page.getByTestId("manual-entry-export");
    await expect(manualExport).toBeHidden();
    expect(await manualExport.boundingBox()).toBeNull();
    await expect(page.getByRole("link", { name: /export csv/i })).toHaveCount(
      0,
    );

    await setStableViewport(page, { width: 1024, height: 900 });
    await expect(manualExport).toBeVisible();
    await capture(page, testInfo, "transactions-desktop-exports-visible");
  });
});
