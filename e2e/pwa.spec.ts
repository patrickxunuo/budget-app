import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];

/** Any currency symbol or cents-precision figure. */
const MONEY = /\$\s?\d|\d+\.\d{2}/;

test("serves an installable manifest with reachable PNG icons", async ({
  request,
}) => {
  const response = await request.get("/manifest.webmanifest");

  expect(response.status()).toBe(200);

  const manifest = (await response.json()) as {
    name: string;
    short_name: string;
    display: string;
    start_url: string;
    scope: string;
    icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
  };

  expect(manifest.name).toBe("Budget App");
  expect(manifest.short_name.length).toBeLessThanOrEqual(12);
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/dashboard");
  expect(manifest.scope).toBe("/");
  expect(manifest.icons).toHaveLength(4);

  for (const icon of manifest.icons) {
    const iconResponse = await request.get(icon.src);
    expect(iconResponse.status(), `${icon.src} must be reachable`).toBe(200);
    expect(iconResponse.headers()["content-type"]).toContain("image/png");
  }
});

test("serves the worker script uncacheable and scoped to the whole origin", async ({
  request,
}) => {
  const response = await request.get("/sw.js");

  expect(response.status()).toBe(200);

  const headers = response.headers();
  expect(headers["cache-control"]).toContain("no-store");
  expect(headers["service-worker-allowed"]).toBe("/");
});

test("declares the install and theme metadata in the document head", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.locator('head link[rel="manifest"]')).toHaveAttribute(
    "href",
    /manifest\.webmanifest/,
  );
  await expect(
    page.locator('head link[rel="apple-touch-icon"]'),
  ).toHaveAttribute("href", /apple-touch-icon/);

  const themeColorMedia = await page
    .locator('head meta[name="theme-color"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("media")));

  expect(themeColorMedia).toContain("(prefers-color-scheme: light)");
  expect(themeColorMedia).toContain("(prefers-color-scheme: dark)");
});

test("offers install guidance for every platform without signing in", async ({
  page,
}) => {
  await page.goto("/install");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  for (const testId of [
    "install-steps-android",
    "install-steps-ios",
    "install-steps-desktop",
  ]) {
    const section = page.getByTestId(testId);
    await expect(section).toBeVisible();
    await expect(section.getByRole("heading", { level: 2 })).toBeVisible();
  }
  await expect(page.getByTestId("install-steps-ios")).toContainText(
    /add to home screen/i,
  );
  await expectNoHorizontalOverflow(page);
});

test("reaches the install guidance from the landing page", async ({ page }) => {
  await page.goto("/");

  await page
    .getByRole("link", { name: /install/i })
    .first()
    .click();

  await expect(page).toHaveURL(/\/install$/);
  await expect(page.getByTestId("install-steps-ios")).toBeVisible();
});

test("explains the offline screen without showing a single figure", async ({
  page,
}) => {
  await page.goto("/offline");

  await expect(
    page.getByRole("heading", { level: 1, name: /offline/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /try again/i }).first(),
  ).toBeVisible();

  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(MONEY);
  await expectNoHorizontalOverflow(page);
});

test("makes Skip to content the first tab stop and moves focus to main", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Tab");

  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await expect(skipLink).toBeFocused();

  await page.keyboard.press("Enter");

  const focusIsInsideMain = await page.evaluate(() => {
    const main = document.getElementById("main-content");
    const active = document.activeElement;
    return Boolean(
      main && active && (main === active || main.contains(active)),
    );
  });

  expect(focusIsInsideMain).toBe(true);
});

for (const viewport of VIEWPORTS) {
  test(`keeps the public shell overflow-free at ${viewport.name} width`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });

    for (const path of ["/", "/install"]) {
      await page.goto(path);
      await expectNoHorizontalOverflow(page);
    }
  });
}

test("captures the install guidance page", async ({ page }, testInfo) => {
  await page.goto("/install");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const installPath = testInfo.outputPath("install-guidance.png");
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: installPath,
  });
  await testInfo.attach("install guidance", {
    contentType: "image/png",
    path: installPath,
  });
});
