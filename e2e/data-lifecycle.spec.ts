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
  test("FE-001 applied Family filters produce a real scoped CSV download with a clear filename", async ({
    page,
  }, testInfo) => {
    requireFixture("data-lifecycle");
    await signIn(page, member?.email, member?.password);
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
    requireFixture("data-lifecycle");
    await signIn(page, member?.email, member?.password);
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
