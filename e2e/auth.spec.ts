import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  fixtureCredentials,
  fixtureEnv,
  requireFixture,
} from "./support/fixtures";

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ animations: "disabled", fullPage: true, path });
  await testInfo.attach(name, { contentType: "image/png", path });
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByTestId("sign-in-submit").click();
  await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);
}

test("FE-001 first visitor completes owner setup and reaches the protected dashboard", async ({
  page,
}, testInfo) => {
  requireFixture("auth-setup");

  await page.goto("/setup");
  await expect(page.getByTestId("auth-form")).toBeVisible();
  await page.getByLabel("Your name").fill("E2E Owner");
  await page.getByLabel("Workspace name").fill("E2E Household");
  await page.getByLabel("Email").fill(`owner-${Date.now()}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("E2E-correct-horse-42!");
  await capture(page, testInfo, "setup");
  await page.getByTestId("setup-submit").click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("FE-002 sign-in, recovery, and reset pages are accessible and recovery does not enumerate accounts", async ({
  page,
}, testInfo) => {
  await page.goto("/sign-in");
  await expect(page.getByTestId("auth-form")).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await capture(page, testInfo, "sign-in");

  await page.goto("/forgot-password");
  const recovery = page.getByTestId("auth-form");
  await expect(recovery).toBeVisible();
  await page.getByLabel("Email").fill(`absent-${Date.now()}@example.test`);
  await page.getByTestId("recovery-submit").click();
  // Scoped to the form: the shell also mounts always-present live regions for
  // connectivity and service-worker updates (GH-13), so an unscoped
  // getByRole("status") is ambiguous under Playwright's strict mode.
  const recoveryStatus = recovery.getByRole("status");
  await expect(recoveryStatus).toContainText(
    "If that address belongs to this family",
  );
  const absentConfirmation = await recoveryStatus.textContent();

  await page
    .getByLabel("Email")
    .fill(fixtureEnv("auth-owner").email ?? "known@example.test");
  await expect(page.getByTestId("recovery-submit")).toBeEnabled();
  await page.getByTestId("recovery-submit").click();
  await expect(recoveryStatus).toHaveText(absentConfirmation ?? "");

  await page.goto("/reset-password");
  await expect(page.getByTestId("auth-form")).toBeVisible();
  await expect(page.getByTestId("reset-submit")).toBeVisible();
});

test("FE-003 invite links distinguish a joinable invitation from terminal invalid states without exposing token data", async ({
  page,
}, testInfo) => {
  requireFixture("auth-invites");
  const {
    valid: validInviteToken,
    expired: expiredInviteToken,
    revoked: revokedInviteToken,
    replayed: replayedInviteToken,
  } = fixtureEnv("auth-invites");
  if (
    !validInviteToken ||
    !expiredInviteToken ||
    !revokedInviteToken ||
    !replayedInviteToken
  )
    return;
  await page.goto(`/invite/${validInviteToken}`);
  await expect(page.getByTestId("invite-status")).toContainText(
    /invited|join/i,
  );
  await expect(page.getByTestId("invite-accept-submit")).toBeVisible();
  await capture(page, testInfo, "valid-invite");

  for (const token of [
    expiredInviteToken,
    revokedInviteToken,
    replayedInviteToken,
  ]) {
    await page.goto(`/invite/${token}`);
    await expect(page.getByTestId("invite-status")).toContainText(
      /invalid|expired|used|unavailable|no longer be accepted/i,
    );
    await expect(page.getByTestId("invite-accept-submit")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(token);
  }
});

test("FE-004 owner creates, copies, and revokes invitations and sees guarded membership operations", async ({
  page,
}) => {
  requireFixture("auth-owner");
  const owner = fixtureCredentials("auth-owner");
  if (!owner) return;
  await signIn(page, owner.email, owner.password);
  await page.goto("/settings/members");
  await expect(page.getByTestId("membership-list")).toBeVisible();
  // Attached rather than visible: with no outstanding invitations this is an
  // empty <ul>, which has zero height and is therefore "hidden" to Playwright.
  // The list gaining a row is asserted below, after one is created.
  await expect(page.getByTestId("invitation-list")).toBeAttached();
  await expect(page.getByTestId("invitation-create-form")).toBeVisible();

  await page
    .getByTestId("invitation-create-form")
    .getByLabel("Email")
    .fill(`invite-${Date.now()}@example.test`);
  await page
    .getByTestId("invitation-create-form")
    .getByRole("button", { name: /create|invite/i })
    .click();
  const inviteUrl = page.getByTestId("invite-url");
  await expect(inviteUrl).toContainText(/\/invite\//);
  await expect(page.getByRole("button", { name: /copy/i })).toBeVisible();
  await page
    .getByRole("button", { name: /revoke/i })
    .last()
    .click();
  // Scoped to this action's own feedback region. Scoping to <main> is not
  // enough: the console keeps one live region per action, and the <output>
  // holding the invite URL carries an implicit status role too, so three
  // elements matched and strict mode rejected it.
  await expect(
    page.getByTestId("invitation-revocation-feedback"),
  ).toContainText(/revoked/i);
  await expect(page.getByTestId("password-confirmation")).toBeAttached();
});

test("FE-005 member can leave but cannot see or invoke owner-only controls", async ({
  page,
}) => {
  requireFixture("auth-member");
  const member = fixtureCredentials("auth-member");
  if (!member) return;
  await signIn(page, member.email, member.password);
  await page.goto("/settings/members");
  await expect(page.getByTestId("membership-list")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /leave workspace/i }),
  ).toBeVisible();
  await expect(page.getByTestId("invitation-create-form")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /remove member|transfer ownership/i }),
  ).toHaveCount(0);
});

test("FE-006 anonymous dashboard access redirects to sign-in with a safe local return path", async ({
  page,
}) => {
  await page.context().clearCookies();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard$/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/dashboard");
});

test("API-011 a session older than 30 days is signed out before protected content is served", async ({
  context,
  page,
}) => {
  requireFixture("auth-expired-session");
  const serializedCookies = fixtureEnv("auth-expired-session").cookies;
  if (!serializedCookies) return;
  const cookies = JSON.parse(serializedCookies) as Parameters<
    typeof context.addCookies
  >[0];
  await context.addCookies(cookies);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in(?:\?.*)?$/);
  await expect(page.getByTestId("auth-form")).toBeVisible();
});
test("FE-007 desktop and mobile auth surfaces avoid overflow, expose focus, and capture key screenshots", async ({
  page,
}, testInfo) => {
  for (const [route, testId, name] of [
    ["/setup", "setup-submit", "setup-responsive"],
    ["/sign-in", "sign-in-submit", "sign-in-responsive"],
  ] as const) {
    await page.goto(route);
    const submit =
      route === "/setup"
        ? page
            .getByTestId("setup-submit")
            .or(page.getByTestId("sign-in-submit"))
        : page.getByTestId(testId);
    await expect(submit).toBeVisible();
    await submit.focus();
    await expect(submit).toBeFocused();
    await expectNoHorizontalOverflow(page);
    await capture(page, testInfo, name);
  }

  // Both blocks are opportunistic extras rather than gates: this case must keep
  // running with no fixtures at all, so it reads the values without requiring
  // the family.
  const validInviteToken = fixtureEnv("auth-invites").valid;
  if (validInviteToken) {
    await page.goto(`/invite/${validInviteToken}`);
    await expectNoHorizontalOverflow(page);
    await capture(page, testInfo, "invite-responsive");
  }

  const owner = fixtureCredentials("auth-owner");
  if (owner) {
    await signIn(page, owner.email, owner.password);
    await page.goto("/settings/members");
    await expectNoHorizontalOverflow(page);
    await capture(page, testInfo, "member-settings-responsive");
  }
});
