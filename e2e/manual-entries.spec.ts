import { expect, test, type Page, type TestInfo } from "@playwright/test";

const memberEmail =
  process.env.E2E_MANUAL_ENTRY_MEMBER_EMAIL ??
  process.env.E2E_CATEGORIES_MEMBER_EMAIL ??
  process.env.E2E_PLAID_MEMBER_EMAIL;
const memberPassword =
  process.env.E2E_MANUAL_ENTRY_MEMBER_PASSWORD ??
  process.env.E2E_CATEGORIES_MEMBER_PASSWORD ??
  process.env.E2E_PLAID_MEMBER_PASSWORD;
const runSeed = Date.now().toString(36);

let personalCategoryId = "";
let familyCategoryId = "";
let personalEntryId = "";
let familyEntryId = "";
let refundEntryId = "";

function requireMemberFixture() {
  test.skip(
    !memberEmail || !memberPassword,
    "Requires an active member via E2E_MANUAL_ENTRY_MEMBER_* (or category/Plaid fallback) credentials.",
  );
}

async function signIn(page: Page) {
  if (!memberEmail || !memberPassword) return;
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(memberEmail);
  await page.getByLabel("Password", { exact: true }).fill(memberPassword);
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

async function prepareCategories(page: Page, testInfo: TestInfo) {
  const categoriesResponse = await page.request.get("/api/categories");
  expect(categoriesResponse.ok()).toBe(true);
  const categoriesBody = (await categoriesResponse.json()) as {
    categories: Array<{
      id: string;
      name: string;
      scope: "family" | "personal";
      archivedAt: string | null;
    }>;
  };
  const family = categoriesBody.categories.find(
    (category) => category.scope === "family" && !category.archivedAt,
  );
  expect(
    family,
    "An active Family category is seeded for every workspace",
  ).toBeTruthy();
  familyCategoryId = family!.id;

  const personalName = `E2E Manual Personal ${testInfo.project.name} ${runSeed}`;
  const personalResponse = await page.request.post("/api/categories", {
    data: { name: personalName, color: "#477b74", scope: "personal" },
  });
  expect(personalResponse.status()).toBe(201);
  const personalBody = (await personalResponse.json()) as {
    category: { id: string };
  };
  personalCategoryId = personalBody.category.id;
}

async function openManualLedger(page: Page) {
  await page.goto("/transactions");
  await expect(page.getByTestId("manual-entry-workbench")).toBeVisible();
  await expect(page.getByTestId("manual-entry-form")).toBeVisible();
}

async function submitEntry(
  page: Page,
  entry: {
    scope: "family" | "personal";
    kind: "income" | "spending" | "refund";
    amount: string;
    description: string;
    categoryId: string;
    notes?: string;
  },
) {
  await page.getByTestId("manual-entry-scope").selectOption(entry.scope);
  await page.getByTestId("manual-entry-kind").selectOption(entry.kind);
  await page.getByTestId("manual-entry-amount").fill(entry.amount);
  await page.getByTestId("manual-entry-date").fill("2026-08-12");
  await page.getByTestId("manual-entry-description").fill(entry.description);
  await page
    .getByTestId("manual-entry-category")
    .selectOption(entry.categoryId);
  await page.getByTestId("manual-entry-notes").fill(entry.notes ?? "");
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/manual-entries") &&
      response.request().method() === "POST",
  );
  await page.getByTestId("manual-entry-submit").click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { entry: { id: string } };
  await expect(
    page.getByTestId(`manual-entry-row-${body.entry.id}`),
  ).toBeVisible();
  return body.entry.id;
}

test.describe("GH-8 Manual/Cash ledger", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(() => requireMemberFixture());

  test("FE-001 creates Personal income and Family spending/refund through real APIs with source and history labels", async ({
    page,
  }, testInfo) => {
    await signIn(page);
    await prepareCategories(page, testInfo);
    await openManualLedger(page);

    personalEntryId = await submitEntry(page, {
      scope: "personal",
      kind: "income",
      amount: "1250.00",
      description: `Cash tutoring ${runSeed}`,
      categoryId: personalCategoryId,
      notes: "August sessions",
    });
    familyEntryId = await submitEntry(page, {
      scope: "family",
      kind: "spending",
      amount: "-42.75",
      description: `Neighbourhood market ${runSeed}`,
      categoryId: familyCategoryId,
      notes: "Bread and fruit",
    });
    refundEntryId = await submitEntry(page, {
      scope: "family",
      kind: "refund",
      amount: "12.50",
      description: `Market refund ${runSeed}`,
      categoryId: familyCategoryId,
    });

    for (const id of [personalEntryId, familyEntryId, refundEntryId]) {
      await expect(page.getByTestId(`manual-entry-row-${id}`)).toContainText(
        /manual|cash/i,
      );
    }
    await expect(
      page.getByTestId(`manual-entry-row-${familyEntryId}`),
    ).toContainText(/created|edited|author/i);
    await capture(page, testInfo, "manual-ledger-created-entries");
  });

  test("FE-002 edits a visible record and preserves invalid input beside an accessible validation error", async ({
    page,
  }, testInfo) => {
    test.skip(!familyEntryId, "Serial creation fixture did not complete.");
    await signIn(page);
    await openManualLedger(page);

    await page.getByTestId(`manual-entry-edit-${familyEntryId}`).click();
    await expect(page.getByTestId("manual-entry-scope")).toHaveValue("family");
    await expect(page.getByTestId("manual-entry-kind")).toHaveValue("spending");
    await expect(page.getByTestId("manual-entry-amount")).toHaveValue("-42.75");
    const corrected = `Neighbourhood market corrected ${runSeed}`;
    await page.getByTestId("manual-entry-description").fill(corrected);
    const saveResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/manual-entries/${familyEntryId}`) &&
        response.request().method() === "PATCH",
    );
    await page.getByTestId("manual-entry-submit").click();
    expect((await saveResponse).status()).toBe(200);
    await expect(
      page.getByTestId(`manual-entry-row-${familyEntryId}`),
    ).toContainText(corrected);

    await page.getByTestId(`manual-entry-edit-${familyEntryId}`).click();
    await page.getByTestId("manual-entry-amount").fill("42.75");
    await page
      .getByTestId("manual-entry-description")
      .fill(`Preserved invalid edit ${runSeed}`);
    await page.getByTestId("manual-entry-submit").click();
    await expect(page.getByTestId("manual-entry-error")).toHaveAttribute(
      "role",
      "alert",
    );
    await expect(page.getByTestId("manual-entry-error")).toContainText(
      /spending|less than zero|invalid|check/i,
    );
    await expect(page.getByTestId("manual-entry-amount")).toHaveValue("42.75");
    await expect(page.getByTestId("manual-entry-description")).toHaveValue(
      `Preserved invalid edit ${runSeed}`,
    );
    await capture(page, testInfo, "manual-ledger-edit-validation");
  });

  test("FE-003 deletes Personal directly and requires cancel/confirm controls before Family deletion", async ({
    page,
  }, testInfo) => {
    test.skip(
      !personalEntryId || !familyEntryId,
      "Serial creation fixture did not complete.",
    );
    await signIn(page);
    await openManualLedger(page);

    const personalDelete = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/manual-entries/${personalEntryId}`) &&
        response.request().method() === "DELETE",
    );
    await page.getByTestId(`manual-entry-delete-${personalEntryId}`).click();
    expect((await personalDelete).status()).toBe(200);
    await expect(
      page.getByTestId(`manual-entry-row-${personalEntryId}`),
    ).toHaveCount(0);

    await page.getByTestId(`manual-entry-delete-${familyEntryId}`).click();
    await expect(
      page.getByTestId(`manual-entry-delete-confirm-${familyEntryId}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`manual-entry-delete-cancel-${familyEntryId}`),
    ).toBeVisible();
    await capture(page, testInfo, "manual-ledger-family-delete-confirmation");

    await page
      .getByTestId(`manual-entry-delete-cancel-${familyEntryId}`)
      .click();
    await expect(
      page.getByTestId(`manual-entry-row-${familyEntryId}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`manual-entry-delete-confirm-${familyEntryId}`),
    ).toHaveCount(0);

    await page.getByTestId(`manual-entry-delete-${familyEntryId}`).click();
    const familyDelete = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/manual-entries/${familyEntryId}`) &&
        response.request().method() === "DELETE",
    );
    await page
      .getByTestId(`manual-entry-delete-confirm-${familyEntryId}`)
      .click();
    expect((await familyDelete).status()).toBe(200);
    await expect(
      page.getByTestId(`manual-entry-row-${familyEntryId}`),
    ).toHaveCount(0);
  });

  test("FE-004 remains usable on mobile with keyboard/reduced motion and downloads filtered CSV", async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await openManualLedger(page);

    const scope = page.getByTestId("manual-entry-scope");
    await scope.focus();
    await expect(scope).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("manual-entry-kind")).toBeFocused();

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("manual-entry-export").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/manual.*\.csv|\.csv$/i);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    await capture(page, testInfo, "manual-ledger-mobile-reduced-motion");

    if (refundEntryId) {
      const response = await page.request.delete(
        `/api/manual-entries/${refundEntryId}`,
        {
          data: { confirmed: true },
        },
      );
      expect(response.status()).toBe(200);
    }
  });
});
