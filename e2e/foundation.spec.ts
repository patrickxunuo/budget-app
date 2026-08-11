import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

test("communicates the read-only product boundary", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /shared money\.\s*clear boundaries\./i,
    }),
  ).toBeVisible();
  await expect(page.getByText("Read-only", { exact: true })).toBeVisible();
  await expect(page.getByText("Canada / CAD", { exact: true })).toBeVisible();
  await expect(page.getByText("Transfers available")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("routes anonymous visitors from the landing page to sign-in", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "View application shell" }).click();

  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Welcome home." }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("provides a recovery path for unknown routes", async ({ page }) => {
  await page.goto("/not-a-real-route");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "This page is not in the ledger.",
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Return home" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("captures the landing page and protected sign-in boundary", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /shared money\.\s*clear boundaries\./i,
    }),
  ).toBeVisible();

  const landingPath = testInfo.outputPath("landing-page.png");
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: landingPath,
  });
  await testInfo.attach("landing page", {
    contentType: "image/png",
    path: landingPath,
  });

  await page.getByRole("link", { name: "View application shell" }).click();
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Welcome home." }),
  ).toBeVisible();

  const dashboardPath = testInfo.outputPath("sign-in-boundary.png");
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: dashboardPath,
  });
  await testInfo.attach("sign-in boundary", {
    contentType: "image/png",
    path: dashboardPath,
  });
});
