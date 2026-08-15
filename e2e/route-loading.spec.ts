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
 * Long enough that a skeleton is unambiguously observable and screenshottable,
 * short enough that four throttled cases per project stay tolerable.
 */
const THROTTLE_MS = 4000;

/** How long the production server gets to deliver a partial route prefetch. */
const PREFETCH_TIMEOUT_MS = 15_000;

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
 * Holds a destination's server response back so the pending phase lasts long
 * enough to assert against. Prefetches are passed through untouched: the
 * route-level fallback is only instant because Next already holds it, and
 * delaying that would remove the very thing under test.
 */
async function throttleNavigation(
  page: Page,
  pathname: string,
  delayMs = THROTTLE_MS,
) {
  await page.route(
    (url) => url.pathname === pathname,
    async (route) => {
      if (route.request().headers()["next-router-prefetch"] !== undefined) {
        await route.continue().catch(() => undefined);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      // An interrupted navigation (FE-002) cancels this request mid-flight;
      // that is the behaviour under test, not a harness failure.
      await route.continue().catch(() => undefined);
    },
  );
}

/**
 * The opposite setup to `throttleNavigation`: refuses the prefetch outright and
 * then holds the navigation back.
 *
 * `useLinkStatus` only reports `pending` until the history entry updates, and a
 * cached fallback commits immediately — the docs say so, and it is the very
 * behaviour AC13 wants. So the pending affordance can only be observed on the
 * path AC10 is really about: a destination Next does *not* already hold. With
 * the prefetch refused, the click has to fetch, and the hint has something to
 * report.
 */
async function blockPrefetchAndThrottle(
  page: Page,
  pathname: string,
  delayMs = THROTTLE_MS,
) {
  await page.route(
    (url) => url.pathname === pathname,
    async (route) => {
      if (route.request().headers()["next-router-prefetch"] !== undefined) {
        await route.abort().catch(() => undefined);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      await route.continue().catch(() => undefined);
    },
  );
}

/**
 * Signs in while listening for the production Link prefetches that cache each
 * destination's route-level fallback, waits for every streamed RSC body to
 * finish, then returns those destinations' links.
 *
 * The listener starts before the dashboard mounts because production Next.js
 * prefetches visible links automatically. `waitForResponse` resolves at the
 * headers; clicking before `response.finished()` can adopt that still-in-flight
 * prefetch and bypass the navigation throttle entirely. Missing or unfinished
 * prefetches are harness failures: continuing without a cached fallback makes
 * a delayed navigation keep showing the previous route, which can never prove
 * loading.tsx behavior.
 */
async function signInWithPrefetchedFallbacks<
  const Destinations extends readonly Destination[],
>(
  page: Page,
  destinations: Destinations,
): Promise<{ [Index in keyof Destinations]: Locator }> {
  const prefetched = destinations.map((destination) =>
    page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return (
          url.pathname === destination.path &&
          response.request().headers().rsc === "1" &&
          response.request().headers()["next-router-prefetch"] !== undefined
        );
      },
      { timeout: PREFETCH_TIMEOUT_MS },
    ),
  );

  await signIn(page);

  const responses = await Promise.all(prefetched);
  for (const [index, response] of responses.entries()) {
    expect(
      response.ok(),
      `${destinations[index]?.path} fallback prefetch must succeed`,
    ).toBe(true);
    expect(
      await response.finished(),
      `${destinations[index]?.path} fallback prefetch must finish before navigation`,
    ).toBeNull();
  }

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

    const [link] = await signInWithPrefetchedFallbacks(page, [destination]);

    const nav = primaryNavigation(page);
    const header = page.getByTestId("workspace-header");
    await expect(nav).toBeVisible();
    await expect(header).toBeVisible();
    await markShellNode(nav);
    await markShellNode(header);
    const navBefore = await handleOf(nav, "the primary navigation");
    const headerBefore = await handleOf(header, "the workspace header");

    await throttleNavigation(page, destination.path);
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

  const [abandoned, intended] = await signInWithPrefetchedFallbacks(page, [
    ACCOUNTS,
    BUDGETS,
  ]);
  // Only the first destination is held back, so the second can land while the
  // first is still in flight and the slow response has something to overwrite.
  await throttleNavigation(page, ACCOUNTS.path);

  await abandoned.click();
  await expect(page.getByTestId("route-skeleton")).toBeVisible();
  await intended.click();

  await expect(page).toHaveURL(/\/budgets(?:\?.*)?$/);
  await expect(page.getByTestId("budget-workbench")).toBeVisible({
    timeout: 30_000,
  });
  // The abandoned response arrives after this point; a navigation that is only
  // "interruptible" until its first reply lands is not interruptible at all.
  await page.waitForTimeout(THROTTLE_MS);
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
  const links = await signInWithPrefetchedFallbacks(page, destinations);

  for (const [index, destination] of destinations.entries()) {
    // Both tuples are created from the same `destinations` value above.
    const link = links[index]!;
    await throttleNavigation(page, destination.path);
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
      const [link] = await signInWithPrefetchedFallbacks(page, [destination]);

      // The prefetch has to go through: a route-level fallback is only instant
      // because Next already holds it, and blocking the prefetch leaves the old
      // page on screen for the whole throttle instead of showing a skeleton
      // (measured — the sweep of this case with the prefetch refused fails
      // outright). So the navigation alone is held back, exactly as in FE-001.
      await throttleNavigation(page, destination.path, 10_000);
      await link.click();

      const skeleton = page.getByTestId("route-skeleton");
      // A longer wait than the default: on the rare occasion the prefetch
      // returned the whole payload rather than just the fallback, the commit is
      // immediate and this is the assertion that should say so plainly.
      await expect(skeleton).toBeVisible({ timeout: 15_000 });
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
  await blockPrefetchAndThrottle(page, CATEGORIES.path);
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
  const [link] = await signInWithPrefetchedFallbacks(page, [BUDGETS]);
  // Long enough to read the computed style under both motion settings before
  // the real page arrives and the skeleton goes away.
  await throttleNavigation(page, BUDGETS.path, 20_000);
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
  await signIn(page);

  // Listen before the source route mounts: production Next.js prefetches the
  // visible Overview link, and the fallback is only testable after that real
  // RSC response succeeds.
  const prefetched = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        url.pathname === DASHBOARD.path &&
        response.request().headers().rsc === "1" &&
        response.request().headers()["next-router-prefetch"] !== undefined
      );
    },
    { timeout: PREFETCH_TIMEOUT_MS },
  );
  await page.goto(TRANSACTIONS.path);
  const prefetchResponse = await prefetched;
  expect(
    prefetchResponse.ok(),
    "dashboard fallback prefetch must succeed",
  ).toBe(true);
  expect(
    await prefetchResponse.finished(),
    "dashboard fallback prefetch must finish before navigation",
  ).toBeNull();

  const dashboardLink = primaryNavigation(page).getByRole("link", {
    name: DASHBOARD.label,
  });
  await expect(dashboardLink).toBeVisible();
  await throttleNavigation(page, DASHBOARD.path, 20_000);
  await dashboardLink.click();

  const skeleton = page.getByTestId("route-skeleton");
  await expect(skeleton).toBeVisible({ timeout: 15_000 });
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
