import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  fixtureCredentials,
  isFixtureProvisioned,
  requireFixture,
} from "./support/fixtures";
import { activateAndObservePending } from "./support/pending";
import { chooseFirstSelectOption, chooseSelectOption } from "./support/select";

const credentials = fixtureCredentials("categories");
const runSeed = Date.now().toString(36);
const familyCategoryName = `E2E Family ${runSeed}`;
const personalCategoryName = `E2E Personal ${runSeed}`;

function requireMemberFixture() {
  requireFixture("categories");
}

// The transaction family declares the member credentials as well as the flag,
// so one gate carries both halves of the old two-step skip.
function requireTransactionFixture() {
  requireFixture("categories-transaction");
}

async function signIn(page: Page) {
  if (!credentials) return;
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByTestId("sign-in-submit").click();
  await expect(page).toHaveURL(
    /\/(?:dashboard|categories|transactions)(?:\?.*)?$/,
  );
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ animations: "disabled", fullPage: true, path });
  await testInfo.attach(name, { contentType: "image/png", path });
}

async function openCategories(page: Page) {
  await signIn(page);
  await page.goto("/categories");
  await expect(page.getByTestId("category-workbench")).toBeVisible();
}

async function openTransactions(page: Page) {
  await signIn(page);
  await page.goto("/transactions");
  await expect(page.getByTestId("transaction-ledger")).toBeVisible();
}

async function createCategory(
  page: Page,
  name: string,
  scope: "family" | "personal",
  color: string,
) {
  await page.getByTestId("category-name").fill(name);
  await page.getByTestId("category-color").fill(color);
  await chooseSelectOption(
    page.getByTestId("category-scope"),
    scope === "family" ? /family/i : /personal/i,
    scope,
  );
  const response = page.waitForResponse(
    (candidate) =>
      candidate.url().endsWith("/api/categories") &&
      candidate.request().method() === "POST",
  );
  const submit = page.getByTestId("category-submit");
  await activateAndObservePending(submit, () => submit.click());
  expect((await response).status()).toBe(201);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

test.describe("GH-7 scoped categories and merchant rules", () => {
  test.describe.configure({ mode: "serial" });

  test("FE-001 member creates Family and Personal categories with clear privacy labels", async ({
    page,
  }, testInfo) => {
    requireMemberFixture();
    await openCategories(page);

    await createCategory(page, familyCategoryName, "family", "#18745b");
    await createCategory(page, personalCategoryName, "personal", "#b56b45");

    const familyEntry = page
      .getByText(familyCategoryName, { exact: true })
      .locator("xpath=ancestor::*[self::li or self::article or self::tr][1]");
    const personalEntry = page
      .getByText(personalCategoryName, { exact: true })
      .locator("xpath=ancestor::*[self::li or self::article or self::tr][1]");
    await expect(familyEntry).toContainText(/family|shared/i);
    await expect(personalEntry).toContainText(/personal|only you|private/i);
    await capture(page, testInfo, "categories-family-personal");
  });

  test("FE-003 transaction shows original Plaid category beside effective category and saves one-off override", async ({
    page,
  }, testInfo) => {
    requireTransactionFixture();
    await openTransactions(page);

    const row = page.locator('[data-testid^="transaction-row-"]').first();
    await expect(row).toBeVisible();
    const transactionId = (await row.getAttribute("data-testid"))!.replace(
      "transaction-row-",
      "",
    );
    const original = row.getByTestId(`original-category-${transactionId}`);
    const effective = row.getByTestId(`effective-category-${transactionId}`);
    await expect(original).not.toBeEmpty();
    await expect(effective).not.toBeEmpty();
    const originalBefore = (await original.textContent())?.trim();

    const select = row.getByTestId(`category-select-${transactionId}`);
    await select.click();
    const candidateNames = await page
      .getByRole("listbox")
      .getByRole("option")
      .allTextContents();
    const targetLabel =
      candidateNames.find((label) => label.includes(familyCategoryName)) ??
      candidateNames.find((label) => label.includes(personalCategoryName));
    test.skip(
      !targetLabel,
      "Created category is not in this transaction's privacy domain.",
    );
    const targetName = targetLabel!.includes(familyCategoryName)
      ? familyCategoryName
      : personalCategoryName;
    const search = page.getByRole("combobox", { name: "Search categories" });
    await search.fill(targetName.toUpperCase());
    await expect(
      page.getByRole("listbox").getByRole("option", { name: targetLabel! }),
    ).toBeVisible();
    await capture(page, testInfo, "transaction-category-search-open");
    await page
      .getByRole("listbox")
      .getByRole("option", { name: targetLabel! })
      .click();
    const mutation = page.waitForResponse(
      (candidate) =>
        candidate
          .url()
          .endsWith(`/api/transactions/${transactionId}/category`) &&
        candidate.request().method() === "PATCH",
    );
    const save = row.getByTestId(`category-save-${transactionId}`);
    await activateAndObservePending(save, () => save.click());
    expect((await mutation).status()).toBe(200);
    await expect(effective).toContainText(
      targetLabel!.includes(familyCategoryName)
        ? familyCategoryName
        : personalCategoryName,
    );
    await expect(effective).toContainText(/manual/i);
    expect((await original.textContent())?.trim()).toBe(originalBefore);
    await capture(page, testInfo, "transaction-manual-category");
  });

  test("FE-002 member archives an in-use custom category while historical transaction label remains intelligible", async ({
    page,
  }, testInfo) => {
    requireTransactionFixture();
    const transactionsResponse = await page.request.get(
      "/api/transactions?scope=family&limit=100",
    );
    expect(transactionsResponse.ok()).toBe(true);
    const transactionBody = (await transactionsResponse.json()) as {
      transactions: Array<{
        effectiveCategory: { name: string; source: string } | null;
      }>;
    };
    const targetName = transactionBody.transactions.find(
      (transaction) =>
        transaction.effectiveCategory?.source === "manual" &&
        [familyCategoryName, personalCategoryName].includes(
          transaction.effectiveCategory.name,
        ),
    )?.effectiveCategory?.name;
    test.skip(!targetName, "No in-use GH-7 custom category is available.");

    await openCategories(page);
    const entry = page
      .getByText(targetName!, { exact: true })
      .locator("xpath=ancestor::*[self::li or self::article or self::tr][1]");
    const archiveResponse = page.waitForResponse(
      (candidate) =>
        /\/api\/categories\/[0-9a-f-]+$/i.test(candidate.url()) &&
        candidate.request().method() === "PATCH",
    );
    await entry.getByRole("button", { name: /archive/i }).click();
    expect((await archiveResponse).status()).toBe(200);
    await expect(entry).toContainText(/archived/i);

    await page.goto("/transactions");
    const ledger = page.getByTestId("transaction-ledger");
    await expect(ledger).toBeVisible();
    await expect(
      ledger.getByText(targetName!, { exact: false }).first(),
    ).toBeVisible();
    await capture(page, testInfo, "archived-category-history");
  });

  test("FE-004 merchant-rule preview shows affected count before confirmation and success announces applied count", async ({
    page,
  }, testInfo) => {
    requireTransactionFixture();
    await openTransactions(page);

    const row = page.locator('[data-testid^="transaction-row-"]').first();
    const transactionId = (await row.getAttribute("data-testid"))!.replace(
      "transaction-row-",
      "",
    );
    const ruleCategory = row.getByTestId(`category-select-${transactionId}`);
    await chooseFirstSelectOption(ruleCategory);
    const previewResponse = page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith("/api/merchant-rules/preview") &&
        candidate.request().method() === "POST",
    );
    const previewRule = row.getByTestId(`rule-create-${transactionId}`);
    await activateAndObservePending(previewRule, () => previewRule.click());
    expect((await previewResponse).status()).toBe(200);
    const preview = page.getByTestId("rule-preview-count");
    await expect(preview).toContainText(/\d+/);
    await capture(page, testInfo, "merchant-rule-preview");

    const createResponse = page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith("/api/merchant-rules") &&
        candidate.request().method() === "POST",
    );
    const confirmRule = page.getByTestId("rule-confirm");
    await activateAndObservePending(confirmRule, () => confirmRule.click());
    expect((await createResponse).status()).toBe(201);
    // Scoped to <main>: the shell mounts always-present connectivity and
    // service-worker live regions outside it, and the last one on the page is
    // now the (empty) update region rather than this feedback (GH-13).
    const status = page
      .getByRole("main")
      .locator('[aria-live="polite"]')
      .last();
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(status).toContainText(/applied|updated|saved/i);
    await capture(page, testInfo, "merchant-rule-applied");
  });

  test("FE-005 desktop/mobile layouts retain keyboard focus, reduced motion, and usable screenshots", async ({
    page,
  }, testInfo) => {
    requireMemberFixture();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await openCategories(page);

    const nameInput = page.getByTestId("category-name");
    await nameInput.focus();
    await expect(nameInput).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("category-color")).toBeFocused();

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await capture(page, testInfo, "categories-mobile-reduced-motion");

    if (isFixtureProvisioned("categories-transaction")) {
      await page.goto("/transactions");
      await expect(page.getByTestId("transaction-ledger")).toBeVisible();
      const row = page.locator('[data-testid^="transaction-row-"]').first();
      await expect(row).toBeVisible();
      await capture(page, testInfo, "transactions-mobile-stacked");
    }
  });
});
