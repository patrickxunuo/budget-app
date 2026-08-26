import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { fixtureCredentials, requireFixture } from "./support/fixtures";
import { activateAndObservePending } from "./support/pending";
import { chooseSelectOption } from "./support/select";

const credentials = fixtureCredentials("plaid-connection");
const repairCredentials = fixtureCredentials("plaid-repair");

function requireConnectionFixture() {
  requireFixture("plaid-connection");
}

async function signIn(page: Page) {
  if (!credentials) return;
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByTestId("sign-in-submit").click();
  await expect(page).toHaveURL(/\/(?:dashboard|accounts)(?:\?.*)?$/);
}

async function openConnections(page: Page) {
  await signIn(page);
  await page.goto("/accounts");
  await expect(page.getByTestId("plaid-connections")).toBeVisible();
  await expect(page.getByTestId(/^plaid-connection-/).first()).toBeVisible();
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ animations: "disabled", fullPage: true, path });
  await testInfo.attach(name, { contentType: "image/png", path });
}

async function chooseFirstDifferentVisibility(page: Page) {
  const visibility = page.getByTestId(/^plaid-visibility-/).first();
  const current = await visibility.getAttribute("data-value");
  if (current === "family") {
    await chooseSelectOption(visibility, /personal.*only me/i, "personal");
  } else {
    await chooseSelectOption(visibility, /family.*shared/i, "family");
  }
  return visibility;
}

test.describe("GH-11 Plaid connection management", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(() => requireConnectionFixture());

  test("FE-001 linker sees a complete masked, healthy, Item-wide account dossier from the real backend", async ({
    page,
  }, testInfo) => {
    const responses: number[] = [];
    page.on("response", (response) => {
      if (new URL(response.url()).pathname === "/api/plaid/connections") {
        responses.push(response.status());
      }
    });

    await openConnections(page);
    const dossier = page.getByTestId(/^plaid-connection-/).first();
    await expect(dossier).toContainText(/bank|credit union|institution/i);
    await expect(dossier).toContainText(/ending|mask|\d{4}/i);
    await expect(dossier).toContainText(/personal|family/i);
    await expect(dossier).toContainText(/available|current|balance/i);
    await expect(dossier).toContainText(/sync|updated/i);
    await expect(page.getByTestId(/^plaid-health-/).first()).toContainText(
      /healthy|attention|repair|disconnected|current/i,
    );
    await expect(page.getByTestId(/^plaid-item-impact-/).first()).toContainText(
      /account|item|connection/i,
    );
    await expect(dossier).not.toContainText(
      /access[-_ ]token|ciphertext|client[-_ ]secret|provider_account_id/i,
    );
    expect(responses.some((status) => status === 200)).toBe(true);
    await capture(page, testInfo, "plaid-connection-dossier");
  });

  test("FE-002 visibility warning explains retroactive recalculation and irreversible prior access before the real mutation", async ({
    page,
  }, testInfo) => {
    await openConnections(page);
    const visibility = await chooseFirstDifferentVisibility(page);
    const accountId = (await visibility.getAttribute("data-testid"))?.replace(
      "plaid-visibility-",
      "",
    );
    expect(accountId).toBeTruthy();
    const warning = page.getByTestId(`plaid-visibility-warning-${accountId}`);
    await expect(warning).toContainText(/retroactive|historical|past/i);
    await expect(warning).toContainText(/dashboard|budget|recalculat/i);
    await expect(warning).toContainText(/cannot undo|prior viewing|export/i);

    const confirmation = warning.getByRole("button", {
      name: /confirm|apply|change visibility/i,
    });
    await expect(confirmation).toBeDisabled();
    await warning
      .getByRole("checkbox", { name: /acknowledge|irreversible|historical/i })
      .check();
    await expect(confirmation).toBeEnabled();
    const patch = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/visibility") &&
        response.request().method() === "PATCH",
    );
    await activateAndObservePending(confirmation, () => confirmation.click());
    expect((await patch).status()).toBe(200);
    await expect(page.getByTestId("plaid-operation-status")).toContainText(
      /visibility|updated|recalculated/i,
    );
    await capture(page, testInfo, "plaid-visibility-retroactive-warning");
  });

  test("FE-003 account-selection update opens Plaid and reconciles returned, new, and deselected accounts through the real backend", async ({
    page,
  }, testInfo) => {
    await openConnections(page);
    const item = page.getByTestId(/^plaid-connection-/).first();
    const updateTokenResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/update-token") &&
        response.request().method() === "POST",
    );
    const reconcileResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/reconcile") &&
        response.request().method() === "POST",
    );
    await chooseSelectOption(
      item.getByLabel(/update reason/i),
      "Change selected accounts",
      "account_selection",
    );
    await item.getByTestId(/^plaid-update-/).click();
    expect((await updateTokenResponse).status()).toBe(200);

    const deterministicDialog = page.getByRole("dialog", {
      name: /E2E Canadian Bank|bank/i,
    });
    if (await deterministicDialog.isVisible().catch(() => false)) {
      await deterministicDialog
        .getByRole("button", { name: /continue/i })
        .click();
    }
    expect((await reconcileResponse).status()).toBe(200);
    await expect(page.getByTestId("plaid-operation-status")).toContainText(
      /returned|new|added|deselected|reconciled|up to date/i,
    );

    const deselected = page.getByTestId(/^plaid-deselected-/).first();
    if (await deselected.count()) {
      await expect(deselected).toContainText(
        /read.only|deselected|no longer selected/i,
      );
      await expect(
        page.getByTestId(/^plaid-delete-deselected-/).first(),
      ).toBeVisible();
    }
    await capture(page, testInfo, "plaid-update-reconciliation");
  });

  test("FE-004 disconnect modes remain distinct, Item-wide, explicit, and announced by the real endpoint", async ({
    page,
  }, testInfo) => {
    requireFixture("plaid-connection-destructive");
    await openConnections(page);
    const item = page.getByTestId(/^plaid-connection-/).first();
    await item.getByTestId(/^plaid-disconnect-/).click();
    const modes = item.getByTestId(/^plaid-disconnect-mode-/);
    await modes.click();
    const listbox = page.getByRole("listbox");
    await expect(
      listbox.getByRole("option", { name: /keep.*history.*retain/i }),
    ).toBeVisible();
    await expect(
      listbox.getByRole("option", { name: /delete.*data.*remove/i }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(item.getByTestId(/^plaid-item-impact-/)).toContainText(
      /account|item|connection/i,
    );

    await chooseSelectOption(modes, /keep.*history/i, "keep_history");
    const confirmation = item.getByTestId(/^plaid-disconnect-confirm-/);
    await expect(confirmation).toContainText(/affects.*account/i);
    const disconnectResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/disconnect") &&
        response.request().method() === "POST",
    );
    const confirmDisconnect = confirmation.getByRole("button", {
      name: /confirm disconnect/i,
    });
    await activateAndObservePending(confirmDisconnect, () =>
      confirmDisconnect.click(),
    );
    expect((await disconnectResponse).status()).toBe(200);
    await expect(page.getByTestId("plaid-operation-status")).toContainText(
      /disconnected|history.*kept/i,
    );
    await capture(page, testInfo, "plaid-disconnect-keep-history");
  });

  test("FE-005 mobile keyboard and reduced-motion use remains readable, focus-visible, and non-color-dependent", async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await openConnections(page);

    const update = page.getByTestId(/^plaid-update-/).first();
    await update.focus();
    await expect(update).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId(/^plaid-reconcile-/).first()).toBeFocused();
    await expect(page.getByTestId(/^plaid-health-/).first()).not.toHaveText("");
    await expect(
      page.getByTestId(/^plaid-item-impact-/).first(),
    ).not.toHaveText("");

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await expect(page.getByTestId("plaid-operation-status")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    await capture(page, testInfo, "plaid-connections-mobile-reduced-motion");
  });
});

test.describe("GH-62 Plaid login repair", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(() => requireFixture("plaid-repair"));

  test("Bug: Plaid repair clears Action needed after verified sync", async ({
    page,
  }, testInfo) => {
    if (!repairCredentials) return;
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(repairCredentials.email);
    await page
      .getByLabel("Password", { exact: true })
      .fill(repairCredentials.password);
    await page.getByTestId("sign-in-submit").click();
    await expect(page).toHaveURL(/\/(?:dashboard|accounts)(?:\?.*)?$/);
    await page.goto("/accounts");

    const freshness = page.getByTestId("plaid-sync-status").first();
    const check = freshness.getByTestId("plaid-sync-check").first();
    await expect(freshness).toContainText("Action needed");
    await expect(check).toBeDisabled();

    const requests: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (
        request.method() === "POST" &&
        (/\/update-token$/.test(path) ||
          /\/reconcile$/.test(path) ||
          path === "/api/plaid/sync")
      ) {
        requests.push(path);
      }
    });
    const updateResponse = page.waitForResponse(
      (response) =>
        /\/update-token$/.test(new URL(response.url()).pathname) &&
        response.request().method() === "POST",
    );
    const reconcileResponse = page.waitForResponse(
      (response) =>
        /\/reconcile$/.test(new URL(response.url()).pathname) &&
        response.request().method() === "POST",
    );
    const syncResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/plaid/sync" &&
        response.request().method() === "POST",
    );

    await page
      .getByTestId(/^plaid-update-/)
      .first()
      .click();
    expect((await updateResponse).status()).toBe(200);
    expect((await reconcileResponse).status()).toBe(200);
    expect((await syncResponse).status()).toBe(200);
    expect(requests).toEqual([
      expect.stringMatching(/\/update-token$/),
      expect.stringMatching(/\/reconcile$/),
      "/api/plaid/sync",
    ]);

    await expect(freshness).toContainText("Connected");
    await expect(freshness).not.toContainText("Action needed");
    await expect(check).toBeEnabled();
    await capture(page, testInfo, "gh-62-plaid-repair-verified-connected");
  });
});
