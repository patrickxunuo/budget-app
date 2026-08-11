import { expect, test, type Page, type TestInfo } from "@playwright/test";

const ownerEmail = process.env.E2E_AUTH_OWNER_EMAIL;
const ownerPassword = process.env.E2E_AUTH_OWNER_PASSWORD;
const memberEmail = process.env.E2E_AUTH_MEMBER_EMAIL;
const memberPassword = process.env.E2E_AUTH_MEMBER_PASSWORD;
const validInviteToken = process.env.E2E_AUTH_VALID_INVITE_TOKEN;
const expiredInviteToken = process.env.E2E_AUTH_EXPIRED_INVITE_TOKEN;
const revokedInviteToken = process.env.E2E_AUTH_REVOKED_INVITE_TOKEN;
const replayedInviteToken = process.env.E2E_AUTH_REPLAYED_INVITE_TOKEN;

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
  test.skip(
    process.env.E2E_AUTH_ALLOW_SETUP !== "1",
    "Requires an isolated, empty Supabase project and E2E_AUTH_ALLOW_SETUP=1.",
  );

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
  await expect(page.getByRole("status")).toContainText(
    "If that address belongs to this family",
  );
  const absentConfirmation = await page.getByRole("status").textContent();

  await page.getByLabel("Email").fill(ownerEmail ?? "known@example.test");
  await expect(page.getByTestId("recovery-submit")).toBeEnabled();
  await page.getByTestId("recovery-submit").click();
  await expect(page.getByRole("status")).toHaveText(absentConfirmation ?? "");

  await page.goto("/reset-password");
  await expect(page.getByTestId("auth-form")).toBeVisible();
  await expect(page.getByTestId("reset-submit")).toBeVisible();
});

test("FE-003 invite links distinguish a joinable invitation from terminal invalid states without exposing token data", async ({
  page,
}, testInfo) => {
  test.skip(
    !validInviteToken ||
      !expiredInviteToken ||
      !revokedInviteToken ||
      !replayedInviteToken,
    "Requires valid, expired, revoked, and replayed invite fixtures in the live Supabase test project.",
  );
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
  test.skip(!ownerEmail || !ownerPassword, "Requires live owner credentials.");
  if (!ownerEmail || !ownerPassword) return;
  await signIn(page, ownerEmail, ownerPassword);
  await page.goto("/settings/members");
  await expect(page.getByTestId("membership-list")).toBeVisible();
  await expect(page.getByTestId("invitation-list")).toBeVisible();
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
  await expect(page.getByRole("status")).toContainText(/revoked/i);
  await expect(page.getByTestId("password-confirmation")).toBeAttached();
});

test("FE-005 member can leave but cannot see or invoke owner-only controls", async ({
  page,
}) => {
  test.skip(
    !memberEmail || !memberPassword,
    "Requires live member credentials.",
  );
  if (!memberEmail || !memberPassword) return;
  await signIn(page, memberEmail, memberPassword);
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
  const serializedCookies = process.env.E2E_AUTH_EXPIRED_SESSION_COOKIES;
  test.skip(
    !serializedCookies,
    "Requires E2E_AUTH_EXPIRED_SESSION_COOKIES from a live user whose absolute session start is over 30 days old.",
  );
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
    const submit = page.getByTestId(testId);
    await expect(submit).toBeVisible();
    await submit.focus();
    await expect(submit).toBeFocused();
    await expectNoHorizontalOverflow(page);
    await capture(page, testInfo, name);
  }

  if (validInviteToken) {
    await page.goto(`/invite/${validInviteToken}`);
    await expectNoHorizontalOverflow(page);
    await capture(page, testInfo, "invite-responsive");
  }

  if (ownerEmail && ownerPassword) {
    await signIn(page, ownerEmail, ownerPassword);
    await page.goto("/settings/members");
    await expectNoHorizontalOverflow(page);
    await capture(page, testInfo, "member-settings-responsive");
  }
});
