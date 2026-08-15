import {
  expect,
  test,
  type ElementHandle,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { fixtureCredentials, requireFixture } from "./support/fixtures";

const credentials = fixtureCredentials("auth-owner");

/** The widths GH-13 fixed the responsive contract at. */
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];

/** Tailwind's `lg`: at or above it the rail renders, below it the bottom bar. */
const RAIL_BREAKPOINT = 1024;

type Destination = { readonly label: string; readonly path: string };

const DASHBOARD: Destination = { label: "Overview", path: "/dashboard" };
const ACCOUNTS: Destination = { label: "Accounts", path: "/accounts" };
const TRANSACTIONS: Destination = {
  label: "Transactions",
  path: "/transactions",
};
const BUDGETS: Destination = { label: "Budgets", path: "/budgets" };
const CATEGORIES: Destination = { label: "Categories", path: "/categories" };

/**
 * Marks a live DOM node so a later assertion can tell "still the same element"
 * from "unmounted and rebuilt": React never re-adds an attribute it did not
 * set, so a rebuilt header comes back without this one.
 */
const SHELL_PROBE = "data-shell-probe";

type ShellHandle = ElementHandle<SVGElement | HTMLElement>;

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

async function signIn(page: Page) {
  if (!credentials) return;
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByTestId("sign-in-submit").click();
  await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);
}

/**
 * The primary navigation that is actually rendered at the current width.
 *
 * Both landmarks are always in the DOM and CSS picks one, so the bottom bar is
 * addressed by test id and the rail by role — a role query skips the
 * `display:none` copy, which is what keeps the desktop query unambiguous.
 */
function primaryNavigation(page: Page): Locator {
  const width = page.viewportSize()?.width ?? 0;
  return width >= RAIL_BREAKPOINT
    ? page.getByRole("navigation", { name: "Primary" })
    : page.getByTestId("mobile-bottom-nav");
}

/**
 * Refuses automatic prefetches so every click exercises a fresh streamed
 * navigation. The CI-only server delay keeps page data pending after Next has
 * sent loading.tsx; delaying the request here would prevent that first chunk.
 */
async function blockPrefetch(page: Page, pathname: string) {
  await page.route(
    (url) => url.pathname === pathname,
    async (route) => {
      if (route.request().headers()["next-router-prefetch"] !== undefined) {
        await route.abort().catch(() => undefined);
        return;
      }
      await route.continue().catch(() => undefined);
    },
  );
}

/**
 * Blocks destination prefetches before the dashboard mounts, signs in, and
 * returns the links rendered at the active viewport. This verifies the visible
 * streaming contract without racing Next's partial-prefetch cache.
 */
async function signInWithDestinationLinks<
  const Destinations extends readonly Destination[],
>(
  page: Page,
  destinations: Destinations,
): Promise<{ [Index in keyof Destinations]: Locator }> {
  await Promise.all(
    destinations.map((destination) => blockPrefetch(page, destination.path)),
  );

  await signIn(page);

  return (await Promise.all(
    destinations.map(async (destination) => {
      const link = primaryNavigation(page).getByRole("link", {
        name: destination.label,
      });
      await expect(link).toBeVisible();
      return link;
    }),
  )) as { [Index in keyof Destinations]: Locator };
}

async function markShellNode(locator: Locator) {
  await locator.evaluate(
    (node, attribute) => node.setAttribute(attribute, "kept"),
    SHELL_PROBE,
  );
}

async function handleOf(
  locator: Locator,
  description: string,
): Promise<ShellHandle> {
  const handle = await locator.elementHandle();
  expect(
    handle,
    `${description} must exist before the transition`,
  ).not.toBeNull();
  return handle as ShellHandle;
}

async function isSameElement(
  page: Page,
  before: ShellHandle,
  after: ShellHandle,
) {
  return page.evaluate(([first, second]) => first === second, [before, after]);
}

for (const destination of [ACCOUNTS, BUDGETS]) {
  test(`FE-001 the shell stays mounted and interactive while ${destination.path} shows its skeleton`, async ({
    page,
  }, testInfo) => {
    requireFixture("auth-owner");
    test.setTimeout(120_000);

    const [link] = await signInWithDestinationLinks(page, [destination]);

    const nav = primaryNavigation(page);
    const header = page.getByTestId("workspace-header");
    await expect(nav).toBeVisible();
    await expect(header).toBeVisible();
    await markShellNode(nav);
    await markShellNode(header);
    const navBefore = await handleOf(nav, "the primary navigation");
    const headerBefore = await handleOf(header, "the workspace header");

    await link.click();

    const skeleton = page.getByTestId("route-skeleton");
    await expect(skeleton).toBeVisible();

    // AC2: the shell is never blanked — and never quietly rebuilt either, which
    // a visibility check alone cannot distinguish.
    await expect(nav).toBeVisible();
    await expect(header).toBeVisible();
    await expect(nav).toHaveAttribute(SHELL_PROBE, "kept");
    await expect(header).toHaveAttribute(SHELL_PROBE, "kept");
    expect(
      await isSameElement(
        page,
        navBefore,
        await handleOf(nav, "the primary navigation"),
      ),
    ).toBe(true);
    expect(
      await isSameElement(
        page,
        headerBefore,
        await handleOf(header, "the workspace header"),
      ),
    ).toBe(true);
    // Still operable, not a frozen picture of a shell. `toBeEnabled` would be
    // vacuous here — Playwright calls every non-form element enabled, so it
    // passes against a completely inert anchor. Focus is a real interaction the
    // shell has to still be able to take.
    await link.focus();
    await expect(link).toBeFocused();
    // AC15: a segment fallback, never the cold-boot loader that sits above the
    // authenticated layout.
    await expect(page.getByTestId("root-loading")).toHaveCount(0);
    await capture(page, testInfo, `route-skeleton-${destination.label}`);

    await expect(page).toHaveURL(new RegExp(`${destination.path}(?:\\?.*)?$`));
    await expect(skeleton).toHaveCount(0, { timeout: 30_000 });
    await expect(header).toHaveAttribute(SHELL_PROBE, "kept");
    await expect(nav).toHaveAttribute(SHELL_PROBE, "kept");
  });
}

test("FE-002 a destination activated while another is pending is the one that resolves", async ({
  page,
}) => {
  requireFixture("auth-owner");
  test.setTimeout(120_000);

  const [abandoned, intended] = await signInWithDestinationLinks(page, [
    ACCOUNTS,
    BUDGETS,
  ]);
  await abandoned.click();
  await expect(page.getByTestId("route-skeleton")).toBeVisible();
  await intended.click();

  await expect(page).toHaveURL(/\/budgets(?:\?.*)?$/);
  await expect(page.getByTestId("budget-workbench")).toBeVisible({
    timeout: 30_000,
  });
  // Give the abandoned stream time to settle; it must not replace the route
  // selected second.
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/\/budgets(?:\?.*)?$/);
  await expect(page.getByTestId("budget-workbench")).toBeVisible();
});

test("FE-003 the cold-boot root loader never appears while switching authenticated tabs", async ({
  page,
}) => {
  requireFixture("auth-owner");
  test.setTimeout(120_000);

  const rootLoader = page.getByTestId("root-loading");
  const skeleton = page.getByTestId("route-skeleton");
  const destinations = [ACCOUNTS, TRANSACTIONS, BUDGETS] as const;
  const links = await signInWithDestinationLinks(page, destinations);

  for (const [index, destination] of destinations.entries()) {
    // Both tuples are created from the same `destinations` value above.
    const link = links[index]!;
    await link.click();

    await expect(skeleton).toBeVisible();
    // The root loader sits above `(app)/layout.tsx`. Seeing it during a tab
    // switch would mean the whole shell had been torn down and rebuilt.
    await expect(rootLoader).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${destination.path}(?:\\?.*)?$`));
    await expect(skeleton).toHaveCount(0, { timeout: 30_000 });
    await expect(rootLoader).toHaveCount(0);
  }
});

// `/accounts` is here alongside the ledger because it carries the widest fixed
// furniture in the set — the link-flow stepper and the sync strip — so it is
// where a 390px overflow would surface first.
for (const destination of [TRANSACTIONS, ACCOUNTS]) {
  for (const viewport of VIEWPORTS) {
    test(`FE-004 the ${destination.path} skeleton stays overflow-free at ${viewport.name} width`, async ({
      page,
    }) => {
      requireFixture("auth-owner");
      test.setTimeout(120_000);

      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      const [link] = await signInWithDestinationLinks(page, [destination]);

      await link.click();

      const skeleton = page.getByTestId("route-skeleton");
      await expect(skeleton).toBeVisible();
      await expectNoHorizontalOverflow(page);
      // The bar or the rail, whichever this width renders, is still there beside
      // the skeleton rather than pushed out of the viewport by it.
      await expect(primaryNavigation(page)).toBeVisible();
      await expect(page.getByTestId("workspace-header")).toBeVisible();
    });
  }
}

test("FE-005 the activated navigation item reports a real pending state while its transition is blocked", async ({
  page,
}) => {
  requireFixture("auth-owner");
  test.setTimeout(120_000);

  // Deliberately no prefetch here: this is the one case that exercises the live
  // `useLinkStatus` hook rather than a jsdom mock of it, so the pending phase
  // has to be real. Install the route before sign-in so production's automatic
  // dashboard prefetch is refused as soon as the shell mounts.
  await blockPrefetch(page, CATEGORIES.path);
  await signIn(page);

  const link = primaryNavigation(page).getByRole("link", {
    name: CATEGORIES.label,
  });
  const indicator = link.getByTestId("nav-pending-indicator");
  await expect(indicator).toHaveAttribute("data-pending", "false");

  await link.click();
  await expect(indicator).toHaveAttribute("data-pending", "true");
  // AC11: the hint is still one always-mounted node, not something conditionally
  // inserted on activation.
  await expect(indicator).toHaveCount(1);

  await expect(page).toHaveURL(/\/categories(?:\?.*)?$/);
  await expect(
    primaryNavigation(page)
      .getByRole("link", { name: CATEGORIES.label })
      .getByTestId("nav-pending-indicator"),
  ).toHaveAttribute("data-pending", "false");
});

test("FE-006 a displayed skeleton drops its sweep entirely under prefers-reduced-motion", async ({
  page,
}) => {
  requireFixture("auth-owner");
  test.setTimeout(120_000);

  const sweepContent = () =>
    page.evaluate(() => {
      const shape = document.querySelector(
        '[data-testid="route-skeleton"] .skeleton',
      );
      return shape ? getComputedStyle(shape, "::after").content : null;
    });

  await page.emulateMedia({ reducedMotion: "reduce" });
  const [link] = await signInWithDestinationLinks(page, [BUDGETS]);
  await link.click();

  await expect(page.getByTestId("route-skeleton")).toBeVisible();

  // AC8: removed, not parked on a frame. The global reduced-motion block only
  // clamps animation-duration, which would leave a lopsided frozen gradient.
  expect(await sweepContent()).toBe("none");

  // And the same shape does carry a sweep when motion is allowed, so the
  // assertion above cannot pass on a rule that simply never applied.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(await sweepContent()).not.toBe("none");
});
test("GH-31 FE-007 streams the data-free dashboard fallback with exactly four route-shaped blocks", async ({
  page,
}, testInfo) => {
  requireFixture("auth-owner");
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await blockPrefetch(page, DASHBOARD.path);
  await signIn(page);

  await page.goto(TRANSACTIONS.path);

  const dashboardLink = primaryNavigation(page).getByRole("link", {
    name: DASHBOARD.label,
  });
  await expect(dashboardLink).toBeVisible();
  await dashboardLink.click();

  const skeleton = page.getByTestId("route-skeleton");
  await expect(skeleton).toBeVisible();
  await expect(skeleton).toHaveAttribute("id", "main-content");
  await expect(skeleton).toHaveAttribute("tabindex", "-1");
  await expect(skeleton).toHaveAttribute("aria-busy", "true");
  await expect(skeleton.getByRole("status")).toHaveCount(1);
  for (const id of [
    "dashboard-skeleton-heading-scope",
    "dashboard-skeleton-budget",
    "dashboard-skeleton-comparison",
    "dashboard-skeleton-accounts",
  ]) {
    await expect(skeleton.getByTestId(id)).toBeVisible();
  }
  await expect(
    skeleton.locator('[data-testid^="dashboard-skeleton-"]'),
  ).toHaveCount(4);
  expect(await skeleton.textContent()).not.toMatch(
    /[\d$£€]|chequing|credit|grocer/i,
  );
  const reducedMotionContent = await skeleton
    .locator(".skeleton")
    .first()
    .evaluate((element) => getComputedStyle(element, "::after").content);
  expect(reducedMotionContent).toBe("none");
  await expectNoHorizontalOverflow(page);
  await capture(page, testInfo, "dashboard-route-skeleton");

  await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);
  await expect(skeleton).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("dashboard-heading")).toBeVisible();
});
