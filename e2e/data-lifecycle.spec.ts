import { expect, test, type Page, type TestInfo } from "@playwright/test";

const memberEmail = process.env.E2E_DATA_LIFECYCLE_MEMBER_EMAIL;
const memberPassword = process.env.E2E_DATA_LIFECYCLE_MEMBER_PASSWORD;
const ownerEmail = process.env.E2E_DATA_LIFECYCLE_OWNER_EMAIL;
const ownerPassword = process.env.E2E_DATA_LIFECYCLE_OWNER_PASSWORD;
const disposableMemberEmail =
  process.env.E2E_DATA_LIFECYCLE_DISPOSABLE_MEMBER_EMAIL;
const disposableMemberPassword =
  process.env.E2E_DATA_LIFECYCLE_DISPOSABLE_MEMBER_PASSWORD;
const disposableWorkspaceName =
  process.env.E2E_DATA_LIFECYCLE_DISPOSABLE_WORKSPACE_NAME;
const allowDestructive =
  process.env.E2E_DATA_LIFECYCLE_ALLOW_DESTRUCTIVE === "1";

function requireCredentials(email?: string, password?: string) {
  test.skip(
    !email || !password,
    "Requires GH-12 real-backend fixture credentials via E2E_DATA_LIFECYCLE_*.",
  );
}

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
  // Scoped to <main>: the shell's connectivity and update live regions sit
  // outside it, and an unscoped status role is ambiguous (GH-13).
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    /confirmed|15 minutes/i,
  );
}

test.describe("GH-12 data portability and lifecycle", () => {
  test("FE-001 applied Family filters produce a real scoped CSV download with a clear filename", async ({
    page,
  }, testInfo) => {
    requireCredentials(memberEmail, memberPassword);
    await signIn(page, memberEmail, memberPassword);
    await page.goto("/dashboard");

    await page.getByTestId("dashboard-scope-family").click();
    await page.getByTestId("dashboard-status-filter").selectOption("all");
    await page.getByTestId("dashboard-inclusion-filter").selectOption("all");
    await page.getByTestId("dashboard-search").fill("a");
    await page.getByTestId("dashboard-search").press("Enter");

    const exportLink = page.getByTestId("dashboard-export-csv");
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

  test("FE-001 Personal export preserves exact custom range and never offers Combined", async ({
    page,
  }) => {
    requireCredentials(memberEmail, memberPassword);
    await signIn(page, memberEmail, memberPassword);
    await page.goto("/dashboard");
    await page.getByTestId("dashboard-scope-personal").click();
    await page.getByTestId("dashboard-period-custom").click();
    await page.getByLabel(/^from$/i).fill("2026-08-01");
    await page.getByLabel(/^to$/i).fill("2026-08-13");
    await page.getByRole("button", { name: /apply|show custom/i }).click();

    const href = await page
      .getByTestId("dashboard-export-csv")
      .getAttribute("href");
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
    requireCredentials(ownerEmail, ownerPassword);
    await signIn(page, ownerEmail, ownerPassword);
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
    requireCredentials(ownerEmail, ownerPassword);
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, ownerEmail, ownerPassword);
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
    test.skip(
      !allowDestructive || !disposableMemberEmail || !disposableMemberPassword,
      "Requires an explicitly disposable member fixture with an Item configured to return an unconfirmed revocation.",
    );
    await signIn(page, disposableMemberEmail, disposableMemberPassword);
    await page.goto("/settings/members");
    await confirmPassword(page, disposableMemberPassword);
    await page
      .getByTestId("account-deletion-confirmation")
      .fill("DELETE MY ACCOUNT");
    await page.getByTestId("delete-account").click();

    const feedback = page.getByRole("main").getByRole("status");
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
    test.skip(
      !allowDestructive ||
        !ownerEmail ||
        !ownerPassword ||
        !disposableWorkspaceName,
      "Requires an explicitly disposable owner/workspace fixture and E2E_DATA_LIFECYCLE_ALLOW_DESTRUCTIVE=1.",
    );
    await signIn(page, ownerEmail, ownerPassword);
    await page.goto("/settings/members");
    await confirmPassword(page, ownerPassword);
    await page
      .getByLabel(/type.*delete the entire workspace/i)
      .fill(disposableWorkspaceName!);
    await page.getByTestId("workspace-deletion-acknowledgement").check();
    await page.getByTestId("delete-workspace").click();
    await expect(page).toHaveURL(/\/setup$/);
  });
});
