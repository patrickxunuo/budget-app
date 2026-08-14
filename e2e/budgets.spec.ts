import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  fixtureCredentials,
  fixtureEnv,
  requireFixture,
} from "./support/fixtures";

const credentials = fixtureCredentials("budgets");
const { supabaseUrl, serviceRoleKey } = fixtureEnv("budgets-service-cleanup");

function requireBudgetFixture() {
  requireFixture("budgets");
}

function requireServiceCleanup() {
  requireFixture("budgets-service-cleanup");
}

async function cleanupBudgetVersions(ids: readonly string[]) {
  if (ids.length === 0) return;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Service-role cleanup was not configured.");
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin
    .from("budgets")
    .delete()
    .in("id", [...ids]);
  if (error) throw new Error("Budget test cleanup failed: " + error.message);
}
async function signIn(page: Page) {
  if (!credentials) return;
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByTestId("sign-in-submit").click();
  await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);
}

async function openBudgets(page: Page) {
  await signIn(page);
  await page.goto("/budgets");
  await expect(page.getByTestId("budget-workbench")).toBeVisible();
  await expect(page.getByTestId("budget-scope-family")).toBeVisible();
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(name + ".png");
  await page.screenshot({ animations: "disabled", fullPage: true, path });
  await testInfo.attach(name, { contentType: "image/png", path });
}

async function waitForBudgetResponse(
  page: Page,
  method: "GET" | "POST" | "PATCH",
  action: () => Promise<void>,
) {
  const pending = page.waitForResponse(
    (response) =>
      response.url().includes("/api/budgets") &&
      response.request().method() === method,
  );
  await action();
  const result = await pending;
  expect(result.status()).toBeGreaterThanOrEqual(200);
  expect(result.status()).toBeLessThan(300);
  return result;
}

test.describe("GH-10 monthly category budgets", () => {
  test.describe.configure({ mode: "serial" });
  test("FE-001 switches real privacy/month models and creates a CAD target atomically", async ({
    page,
  }, testInfo) => {
    requireBudgetFixture();
    requireServiceCleanup();
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "Mutating budget journey runs once on desktop; mobile coverage is read-only.",
    );
    await openBudgets(page);
    expect(await page.getByRole("button", { name: /combined/i }).count()).toBe(
      0,
    );

    await waitForBudgetResponse(page, "GET", () =>
      page.getByTestId("budget-scope-personal").click(),
    );
    await expect(page.getByTestId("budget-scope-personal")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitForBudgetResponse(page, "GET", () =>
      page.getByTestId("budget-scope-family").click(),
    );
    const previousMonth = await page.getByTestId("budget-month").textContent();
    await waitForBudgetResponse(page, "GET", () =>
      page.getByTestId("budget-previous-month").click(),
    );
    expect(await page.getByTestId("budget-month").textContent()).not.toBe(
      previousMonth,
    );
    await waitForBudgetResponse(page, "GET", () =>
      page.getByTestId("budget-next-month").click(),
    );

    const createdIds: string[] = [];
    try {
      await page.getByTestId("budget-create").click();
      const category = page.getByTestId("budget-category");
      const categoryValue = await category
        .locator("option[value]:not([value=''])")
        .first()
        .getAttribute("value");
      test.skip(!categoryValue, "Requires an available active category.");
      await category.selectOption(categoryValue!);
      await page.getByTestId("budget-amount").fill("237.41");
      const effectiveMonth = await page
        .getByTestId("budget-effective-month")
        .inputValue();
      const createdResponse = await waitForBudgetResponse(page, "POST", () =>
        page.getByTestId("budget-save").click(),
      );
      const payload = (await createdResponse.json()) as {
        budget?: { id?: string };
      };
      if (!payload.budget?.id)
        throw new Error("Create response did not return an ID.");
      createdIds.push(payload.budget.id);
      await expect(page.getByTestId("budget-target-list")).toContainText(
        /237\.41/,
      );
      await expect(page.getByTestId("budget-summary-target")).toContainText(
        /\$|CAD/,
      );
      await expect(page.getByTestId("budget-summary-spent")).toBeVisible();
      await expect(page.getByTestId("budget-summary-remaining")).toBeVisible();
      expect(effectiveMonth).toMatch(/^\d{4}-\d{2}-01$/);
      await capture(page, testInfo, "budgets-created-real-family-target");
    } finally {
      await cleanupBudgetVersions(createdIds);
    }
  });

  test("FE-002 revision preserves current month, creates a new ID next month, and archive is immediate", async ({
    page,
  }, testInfo) => {
    requireBudgetFixture();
    requireServiceCleanup();
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "Mutating budget journey runs once on desktop; mobile coverage is read-only.",
    );
    await openBudgets(page);

    const createdIds: string[] = [];
    try {
      await page.getByTestId("budget-create").click();
      const category = page.getByTestId("budget-category");
      const categoryValue = await category
        .locator("option[value]:not([value=''])")
        .first()
        .getAttribute("value");
      test.skip(!categoryValue, "Requires an available active category.");
      await category.selectOption(categoryValue!);
      await page.getByTestId("budget-amount").fill("345.67");
      const currentEffective = await page
        .getByTestId("budget-effective-month")
        .inputValue();
      const [year, month] = currentEffective.split("-").map(Number);
      if (!year || !month) throw new Error("Expected a valid effective month.");
      const nextEffective = new Date(Date.UTC(year, month, 1))
        .toISOString()
        .slice(0, 10);
      const createResponse = await waitForBudgetResponse(page, "POST", () =>
        page.getByTestId("budget-save").click(),
      );
      const createPayload = (await createResponse.json()) as {
        budget?: { id?: string };
      };
      const currentId = createPayload.budget?.id;
      if (!currentId) throw new Error("Create response did not return an ID.");
      createdIds.push(currentId);

      await page.getByTestId("budget-edit-" + currentId).click();
      await page.getByTestId("budget-amount").fill("612.34");
      await page.getByTestId("budget-effective-month").fill(nextEffective);
      const reviseResponse = await waitForBudgetResponse(page, "PATCH", () =>
        page.getByTestId("budget-save").click(),
      );
      const revisePayload = (await reviseResponse.json()) as {
        budget?: { id?: string };
      };
      const revisedId = revisePayload.budget?.id;
      if (!revisedId)
        throw new Error("Revision response did not return an ID.");
      createdIds.push(revisedId);
      expect(revisedId).not.toBe(currentId);
      await expect(page.getByTestId("budget-edit-" + currentId)).toBeVisible();
      await expect(page.getByTestId("budget-target-list")).toContainText(
        /345\.67/,
      );
      await expect(page.getByTestId("budget-target-list")).not.toContainText(
        /612\.34/,
      );

      await waitForBudgetResponse(page, "GET", () =>
        page.getByTestId("budget-next-month").click(),
      );
      await expect(page.getByTestId("budget-target-list")).toContainText(
        /612\.34/,
      );
      await expect(page.getByTestId("budget-edit-" + revisedId)).toBeVisible();
      await waitForBudgetResponse(page, "PATCH", () =>
        page.getByTestId("budget-archive-" + revisedId).click(),
      );
      await expect(page.getByTestId("budget-edit-" + revisedId)).toHaveCount(0);
      await capture(page, testInfo, "budgets-revised-and-archived");

      await waitForBudgetResponse(page, "GET", () =>
        page.getByTestId("budget-previous-month").click(),
      );
      await expect(page.getByTestId("budget-target-list")).toContainText(
        /345\.67/,
      );
      // currentId is already closed by revision; never archive it through the product API.
    } finally {
      await cleanupBudgetVersions(createdIds);
    }
  });

  test("FE-003 real threshold fixtures communicate watch close at-limit and over without colour alone", async ({
    page,
  }, testInfo) => {
    requireBudgetFixture();
    await openBudgets(page);
    const statuses = page.locator('[data-testid^="budget-status-"]');
    test.skip(
      (await statuses.count()) < 4,
      "Requires 75%, 90%, 100%, and over budget progress fixtures.",
    );
    const statusText = (await statuses.allTextContents()).join(" ");
    expect(statusText).toMatch(/watch/i);
    expect(statusText).toMatch(/close/i);
    expect(statusText).toMatch(/at.?limit/i);
    expect(statusText).toMatch(/over/i);
    for (const status of await statuses.all()) {
      await expect(status).toBeVisible();
      expect(
        await status
          .locator("svg, [aria-hidden='true'], [data-icon], [data-shape]")
          .count(),
      ).toBeGreaterThan(0);
    }
    const progress = page.locator('[data-testid^="budget-progress-"]');
    await expect(progress.first()).toContainText(/spent/i);
    await expect(progress.first()).toContainText(/remaining/i);
    expect((await progress.allTextContents()).join(" ")).toMatch(/75%|75\.0%/);
    expect((await progress.allTextContents()).join(" ")).toMatch(/90%|90\.0%/);
    expect((await progress.allTextContents()).join(" ")).toMatch(/100%/);
    expect((await progress.allTextContents()).join(" ")).toMatch(
      /over.*\$|\$.*over/i,
    );
    await capture(page, testInfo, "budgets-accessible-threshold-states");
  });

  test("FE-004 a real save failure is announced while the prior model and entered values remain", async ({
    page,
  }, testInfo) => {
    requireBudgetFixture();
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "Offline form-preservation journey uses the serial desktop fixture; mobile coverage is read-only.",
    );
    await openBudgets(page);
    const original = await page.getByTestId("budget-target-list").textContent();
    await page.getByTestId("budget-create").click();
    const category = page.getByTestId("budget-category");
    const categoryValue = await category
      .locator("option[value]:not([value=''])")
      .first()
      .getAttribute("value");
    test.skip(!categoryValue, "Requires an available active category.");
    await category.selectOption(categoryValue!);
    await page.getByTestId("budget-amount").fill("444.44");
    await page.context().setOffline(true);
    await page.getByTestId("budget-save").click();
    const error = page.getByTestId("budget-error");
    await expect(error).toHaveAttribute("role", "alert");
    await expect(error).toContainText(/try again|retry|connection|save/i);
    expect(await page.getByTestId("budget-target-list").textContent()).toBe(
      original,
    );
    await expect(page.getByTestId("budget-category")).toHaveValue(
      categoryValue!,
    );
    await expect(page.getByTestId("budget-amount")).toHaveValue("444.44");
    await page.context().setOffline(false);
    await capture(page, testInfo, "budgets-save-error-preserves-work");
  });

  test("FE-005 keyboard mobile and reduced-motion use remains named focused and overflow-safe", async ({
    page,
  }, testInfo) => {
    requireBudgetFixture();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await openBudgets(page);
    for (const id of [
      "budget-scope-family",
      "budget-scope-personal",
      "budget-previous-month",
      "budget-next-month",
      "budget-create",
    ]) {
      await expect(page.getByTestId(id)).toHaveAccessibleName(/.+/);
    }
    await expect(page.getByTestId("budget-month")).toContainText(/\w+\s+\d{4}/);
    const family = page.getByTestId("budget-scope-family");
    await family.focus();
    await expect(family).toBeFocused();
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    expect(
      (
        (await focused.getAttribute("aria-label")) ??
        (await focused.textContent()) ??
        ""
      ).trim(),
    ).not.toBe("");
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await capture(page, testInfo, "budgets-mobile-reduced-motion");
  });
});
