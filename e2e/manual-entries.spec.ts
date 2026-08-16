import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { sameOriginHeaders } from "./support/api";
import { fixtureCredentials, requireFixture } from "./support/fixtures";

const credentials = fixtureCredentials("manual-entries");
const runSeed = Date.now().toString(36);
const entryDate = (() => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
})();

let runLabel = runSeed;
let personalCategoryId = "";
let familyCategoryId = "";
let personalEntryId = "";
let familyEntryId = "";
let refundEntryId = "";

function requireMemberFixture() {
  requireFixture("manual-entries");
}

async function signIn(page: Page) {
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

async function createCategory(
  page: Page,
  scope: "family" | "personal",
  color: string,
) {
  const response = await page.request.post("/api/categories", {
    data: {
      name: `E2E Manual ${scope} ${runLabel}`,
      color,
      scope,
    },
    headers: sameOriginHeaders(page),
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { category: { id: string } };
  return body.category.id;
}

async function prepareCategories(page: Page, testInfo: TestInfo) {
  runLabel = `${testInfo.project.name}-${runSeed}`;
  personalCategoryId = await createCategory(page, "personal", "#477B74");
  familyCategoryId = await createCategory(page, "family", "#B55D3B");
}

async function openManualLedger(page: Page, scope: "family" | "personal") {
  await page.goto(`/transactions?scope=${scope}`);
  await expect(page).toHaveURL(
    new RegExp(`/transactions\\?(?:.*&)?scope=${scope}(?:&.*)?$`),
  );
  await expect(page.getByTestId("manual-entry-workbench")).toBeVisible();
  await expect(page.getByTestId("manual-entry-form")).toBeVisible();
  await expect(page.getByTestId("manual-entry-scope")).toHaveValue(scope);
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
  await expect(page.getByTestId("manual-entry-scope")).toHaveValue(entry.scope);
  await page.getByTestId("manual-entry-kind").selectOption(entry.kind);
  await page.getByTestId("manual-entry-amount").fill(entry.amount);
  await page.getByTestId("manual-entry-date").fill(entryDate);
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
  return body.entry.id;
}

test.describe("GH-35 Manual/Cash real-backend journeys", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(() => requireMemberFixture());

  test("FE-001 creates scoped Personal income and Family spending/refund with source and history labels", async ({
    page,
  }, testInfo) => {
    await signIn(page);
    await prepareCategories(page, testInfo);

    await openManualLedger(page, "family");
    personalEntryId = await submitEntry(page, {
      scope: "personal",
      kind: "income",
      amount: "1250.00",
      description: `Cash tutoring ${runLabel}`,
      categoryId: personalCategoryId,
      notes: "August sessions",
    });
    await expect(
      page.getByTestId(`manual-entry-row-${personalEntryId}`),
    ).toHaveCount(0);

    await openManualLedger(page, "personal");
    await expect(
      page.getByTestId(`manual-entry-row-${personalEntryId}`),
    ).toContainText(/manual|cash/i);
    await capture(page, testInfo, "manual-ledger-personal-created-entry");

    await openManualLedger(page, "family");
    await expect(
      page.getByTestId(`manual-entry-row-${personalEntryId}`),
    ).toHaveCount(0);
    familyEntryId = await submitEntry(page, {
      scope: "family",
      kind: "spending",
      amount: "-42.75",
      description: `Neighbourhood market ${runLabel}`,
      categoryId: familyCategoryId,
      notes: "Bread and fruit",
    });
    refundEntryId = await submitEntry(page, {
      scope: "family",
      kind: "refund",
      amount: "12.50",
      description: `Market refund ${runLabel}`,
      categoryId: familyCategoryId,
    });
    for (const id of [familyEntryId, refundEntryId]) {
      await expect(page.getByTestId(`manual-entry-row-${id}`)).toContainText(
        /manual|cash/i,
      );
    }
    await expect(
      page.getByTestId(`manual-entry-row-${familyEntryId}`),
    ).toContainText(/created|edited|author/i);
    await capture(page, testInfo, "manual-ledger-family-created-entries");

    await openManualLedger(page, "personal");
    await expect(
      page.getByTestId(`manual-entry-row-${personalEntryId}`),
    ).toBeVisible();
    for (const id of [familyEntryId, refundEntryId]) {
      await expect(page.getByTestId(`manual-entry-row-${id}`)).toHaveCount(0);
    }
  });

  test("FE-002 edits the row from its Family ledger and preserves invalid input beside an accessible error", async ({
    page,
  }, testInfo) => {
    test.skip(!familyEntryId, "Serial creation fixture did not complete.");
    await signIn(page);
    await openManualLedger(page, "family");

    await page.getByTestId(`manual-entry-edit-${familyEntryId}`).click();
    await expect(page.getByTestId("manual-entry-scope")).toHaveValue("family");
    await expect(page.getByTestId("manual-entry-kind")).toHaveValue("spending");
    await expect(page.getByTestId("manual-entry-amount")).toHaveValue("-42.75");
    const corrected = `Neighbourhood market corrected ${runLabel}`;
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
      .fill(`Preserved invalid edit ${runLabel}`);
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
      `Preserved invalid edit ${runLabel}`,
    );
    await capture(page, testInfo, "manual-ledger-edit-validation");
  });

  test("FE-002 deletes each row from its matching ledger and confirms Family deletion", async ({
    page,
  }, testInfo) => {
    test.skip(
      !personalEntryId || !familyEntryId,
      "Serial creation fixture did not complete.",
    );
    await signIn(page);
    await openManualLedger(page, "personal");

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

    await openManualLedger(page, "family");
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

  test("FE-002 keeps the Family ledger usable on mobile and exports its filtered CSV", async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await openManualLedger(page, "family");

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
      const status = await page.evaluate(async (entryId) => {
        const response = await fetch(`/api/manual-entries/${entryId}`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmed: true }),
        });
        return response.status;
      }, refundEntryId);
      expect(status).toBe(200);
    }
  });
});
