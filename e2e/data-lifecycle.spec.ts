import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  fixtureCredentials,
  fixtureEnv,
  requireFixture,
} from "./support/fixtures";

const member = fixtureCredentials("data-lifecycle");
const owner = fixtureCredentials("data-lifecycle-owner");
const disposableMember = fixtureCredentials("data-lifecycle-destructive");
const disposableWorkspaceOwner = fixtureCredentials(
  "data-lifecycle-workspace-destructive",
);
const disposableWorkspaceName = fixtureEnv(
  "data-lifecycle-workspace-destructive",
).workspaceName;

async function signIn(page: Page, email?: string, password?: string) {
  if (!email || !password) return;
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByTestId("sign-in-submit").click();
  await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ animations: "disabled", fullPage: true, path });
  await testInfo.attach(name, { contentType: "image/png", path });
}

async function confirmPassword(page: Page, password?: string) {
  if (!password) return;
  await page.getByLabel("Current password").fill(password);
  await page.getByRole("button", { name: /confirm password/i }).click();
  // Scoped to this action's own feedback region; see the note in auth.spec.ts.
  await expect(
    page.getByTestId("password-confirmation-feedback"),
  ).toContainText(/confirmed|15 minutes/i);
}

test.describe("GH-12 data portability and lifecycle", () => {
  // Re-pointed to /transactions by GH-30, which moved exploration and export
  // off the dashboard onto the Transactions tab. Still GH-12 criteria: the
  // filename shape, the real download, and the absence of a Combined scope are
  // asserted exactly as strictly as they were on /dashboard.
  test("FE-001 applied Family filters produce a real scoped CSV download with a clear filename", async ({
    page,
  }, testInfo) => {
    requireFixture("data-lifecycle");
    await signIn(page, member?.email, member?.password);
    await page.goto("/transactions");

    await page.getByTestId("transactions-scope-family").click();
    await expect(page.getByTestId("transactions-scope-family")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByTestId("transactions-status-filter").selectOption("all");
    await page.getByTestId("transactions-inclusion-filter").selectOption("all");
    await page.getByTestId("transactions-search").fill("a");
    await page.getByTestId("transactions-search").press("Enter");

    const exportLink = page.getByTestId("transactions-export-csv");
    await expect(exportLink).toHaveAttribute("href", /scope=family/);
    await expect(exportLink).toHaveAttribute("href", /status=all/);
    await expect(exportLink).toHaveAttribute("href", /inclusion=all/);
    await expect(exportLink).toHaveAttribute("href", /search=a/);
    const downloadPromise = page.waitForEvent("download");
    await exportLink.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      /^budget-app-family-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    expect(await download.failure()).toBeNull();
    await capture(page, testInfo, "data-export-family-filtered");
  });

  // Re-pointed to /transactions by GH-30; see the note on the case above.
  test("FE-001 Personal export preserves exact custom range and never offers Combined", async ({
    page,
  }) => {
    requireFixture("data-lifecycle");
    await signIn(page, member?.email, member?.password);
    await page.goto("/transactions");
    await page.getByTestId("transactions-scope-personal").click();
    await expect(
      page.getByTestId("transactions-scope-personal"),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("transactions-period-custom").click();
    await page.getByTestId("transactions-custom-from").fill("2026-08-01");
    await page.getByTestId("transactions-custom-to").fill("2026-08-13");
    await page.getByTestId("transactions-custom-apply").click();

    // The href is withheld while the refresh it describes is in flight, so wait
    // for the applied snapshot rather than reading a torn intermediate value.
    // Wait on the applied end date, not merely on `period=custom`: choosing the
    // Custom period already fires a request carrying the model's own range, and
    // that earlier snapshot also matches `period=custom`.
    const exportLink = page.getByTestId("transactions-export-csv");
    await expect(exportLink).toHaveAttribute("href", /to=2026-08-13/);
    const href = await exportLink.getAttribute("href");
    expect(href).toContain("scope=personal");
    expect(href).toContain("period=custom");
    expect(href).toContain("from=2026-08-01");
    expect(href).toContain("to=2026-08-13");
    await expect(page.getByRole("button", { name: /combined/i })).toHaveCount(
      0,
    );
  });

  test("FE-002 invalid destructive confirmations remain blocked without backend mutation", async ({
    page,
  }, testInfo) => {
    requireFixture("data-lifecycle-owner");
    await signIn(page, owner?.email, owner?.password);
    await page.goto("/settings/members");

    await page
      .getByTestId("account-deletion-confirmation")
      .fill("delete my account");
    await expect(page.getByTestId("delete-account")).toBeDisabled();
    const workspaceName = page.getByLabel(/type.*delete the entire workspace/i);
    await workspaceName.fill("wrong workspace");
    await page.getByTestId("workspace-deletion-acknowledgement").check();
    await expect(page.getByTestId("delete-workspace")).toBeDisabled();
    await expect(page).toHaveURL(/\/settings\/members/);
    await capture(page, testInfo, "data-lifecycle-invalid-confirmations");
  });

  test("FE-003 owner danger zone explains provider-first retries, member notification, and admin backups on mobile", async ({
    page,
  }, testInfo) => {
    requireFixture("data-lifecycle-owner");
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, owner?.email, owner?.password);
    await page.goto("/settings/members");

    const danger = page.getByTestId("data-lifecycle-danger-zone");
    await expect(danger).toContainText(/plaid/i);
    await expect(danger).toContainText(/retry/i);
    await expect(danger).toContainText(/notify|email/i);
    await expect(danger).toContainText(/supabase/i);
    await expect(danger).toContainText(/backup|restore/i);
    await page.getByTestId("account-deletion-confirmation").focus();
    await expect(
      page.getByTestId("account-deletion-confirmation"),
    ).toBeFocused();
    const widths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    await capture(page, testInfo, "data-lifecycle-owner-danger-zone-mobile");
  });

  test("FE-004 unconfirmed provider revocation stays retryable without exposing credentials", async ({
    page,
  }, testInfo) => {
    requireFixture("data-lifecycle-destructive");
    await signIn(page, disposableMember?.email, disposableMember?.password);
    await page.goto("/settings/members");
    await confirmPassword(page, disposableMember?.password);
    await page
      .getByTestId("account-deletion-confirmation")
      .fill("DELETE MY ACCOUNT");
    await page.getByTestId("delete-account").click();

    const feedback = page.getByTestId("account-deletion-feedback");
    await expect(feedback).toContainText(/could not.*confirm|retry/i);
    await expect(feedback).not.toContainText(/access[_ -]?token|smtp|secret/i);
    await expect(page.getByTestId("account-deletion-confirmation")).toHaveValue(
      "DELETE MY ACCOUNT",
    );
    await expect(page).toHaveURL(/\/settings\/members/);
    await capture(page, testInfo, "data-lifecycle-provider-retry");
  });

  test("FE-003 confirmed disposable owner workspace deletion returns the installation to setup", async ({
    page,
  }) => {
    requireFixture("data-lifecycle-workspace-destructive");
    await signIn(
      page,
      disposableWorkspaceOwner?.email,
      disposableWorkspaceOwner?.password,
    );
    await page.goto("/settings/members");
    await confirmPassword(page, disposableWorkspaceOwner?.password);
    await page
      .getByLabel(/type.*delete the entire workspace/i)
      .fill(disposableWorkspaceName!);
    await page.getByTestId("workspace-deletion-acknowledgement").check();
    await page.getByTestId("delete-workspace").click();
    await expect(page).toHaveURL(/\/setup$/);
  });
});

/**
 * New under GH-30. The shareable-link criterion is the reason filter state is
 * synchronised into the address bar at all: the view a household member builds
 * has to survive a reload and be reproducible by anyone who opens the same URL
 * in the same household. It rides the same `data-lifecycle` member as the
 * re-pointed GH-12 export journeys above, because it needs the same thing from
 * the environment: a signed-in member who can load `/transactions`.
 */
test.describe("GH-30 transactions exploration and export", () => {
  test("FE-007 a filtered view survives a reload and is reproduced from a shared link", async ({
    page,
    context,
  }, testInfo) => {
    requireFixture("data-lifecycle");
    await signIn(page, member?.email, member?.password);
    await page.goto("/transactions");

    await page.getByTestId("transactions-status-filter").selectOption("posted");
    await page.getByTestId("transactions-inclusion-filter").selectOption("all");
    await page.getByTestId("transactions-search").fill("a");
    await page.getByTestId("transactions-search").press("Enter");

    // The applied view lives in the address bar, not only in component state.
    await expect(page).toHaveURL(/status=posted/);
    await expect(page).toHaveURL(/inclusion=all/);
    await expect(page).toHaveURL(/search=a/);
    const shared = page.url();

    const rowsOf = (target: Page) =>
      target.locator(
        '[data-testid^="transactions-result-"]:not([data-testid="transactions-result-list"])',
      );
    const spending = await page
      .getByTestId("transactions-summary-spending")
      .textContent();
    const rowCount = await rowsOf(page).count();

    await page.reload();
    await expect(page.getByTestId("transactions-status-filter")).toHaveValue(
      "posted",
    );
    await expect(page.getByTestId("transactions-inclusion-filter")).toHaveValue(
      "all",
    );
    await expect(page.getByTestId("transactions-search")).toHaveValue("a");
    await expect(page.getByTestId("transactions-summary-spending")).toHaveText(
      spending ?? "",
    );
    await expect(rowsOf(page)).toHaveCount(rowCount);
    await expect(page.getByTestId("transactions-export-csv")).toHaveAttribute(
      "href",
      /status=posted/,
    );

    // A fresh page in the same household reproduces the same filtered view.
    const sharedPage = await context.newPage();
    await sharedPage.goto(shared);
    await expect(
      sharedPage.getByTestId("transactions-status-filter"),
    ).toHaveValue("posted");
    await expect(
      sharedPage.getByTestId("transactions-inclusion-filter"),
    ).toHaveValue("all");
    await expect(sharedPage.getByTestId("transactions-search")).toHaveValue(
      "a",
    );
    await expect(
      sharedPage.getByTestId("transactions-summary-spending"),
    ).toHaveText(spending ?? "");
    await expect(rowsOf(sharedPage)).toHaveCount(rowCount);
    await expect(
      sharedPage.getByRole("button", { name: /combined/i }),
    ).toHaveCount(0);
    await capture(sharedPage, testInfo, "transactions-shared-filtered-view");
    await sharedPage.close();
  });
});
