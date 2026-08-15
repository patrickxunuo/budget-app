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

/** How long a hover-triggered prefetch is given before the spec moves on. */
const PREFETCH_TIMEOUT_MS = 8000;

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
 * Visits a destination once so the server has compiled it.
 *
 * CI runs this suite against `next dev` (`E2E_SERVER_MODE=dev`, see
 * `memory-bank/devSetup.md`), where the first request for a route pays for its
 * compilation. Without the warm-up, a "prefetch" would time out on a compile
 * and the click would land with nothing cached to commit.
 */
async function warmDestination(page: Page, destination: Destination) {
  await page.goto(destination.path);
  await expect(page).toHaveURL(new RegExp(`${destination.path}(?:\\?.*)?$`));
}

/**
 * Leaves the destination's route-level fallback cached, and returns its link.
 *
 * `next dev` compiles viewport prefetching out for performance, so the hover is
 * not decoration: intent prefetching is the only path that populates the cache
 * there. AC3 names the prefetched fallback as the primary feedback, so this is
 * the state the product is specified to navigate from.
 */
async function prefetchFromShell(
  page: Page,
  destination: Destination,
): Promise<Locator> {
  const link = primaryNavigation(page).getByRole("link", {
    name: destination.label,
  });
  await expect(link).toBeVisible();
  const prefetched = page
    .waitForResponse(
      (response) => new URL(response.url()).pathname === destination.path,
      { timeout: PREFETCH_TIMEOUT_MS },
    )
    .catch(() => undefined);
  await link.hover();
  await prefetched;
  return link;
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
    // Two warm-up navigations plus a deliberately throttled one, against a dev
    // server that compiles on demand.
    test.setTimeout(120_000);

    await signIn(page);
    await warmDestination(page, destination);
    await page.goto("/dashboard");

    const nav = primaryNavigation(page);
    const header = page.getByTestId("workspace-header");
    await expect(nav).toBeVisible();
    await expect(header).toBeVisible();
    await markShellNode(nav);
    await markShellNode(header);
    const navBefore = await handleOf(nav, "the primary navigation");
    const headerBefore = await handleOf(header, "the workspace header");

    const link = await prefetchFromShell(page, destination);
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

  await signIn(page);
  await warmDestination(page, ACCOUNTS);
  await warmDestination(page, BUDGETS);
  await page.goto("/dashboard");

  const abandoned = await prefetchFromShell(page, ACCOUNTS);
  const intended = await prefetchFromShell(page, BUDGETS);
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

  await signIn(page);
  const rootLoader = page.getByTestId("root-loading");
  const skeleton = page.getByTestId("route-skeleton");

  for (const destination of [ACCOUNTS, TRANSACTIONS, BUDGETS]) {
    await warmDestination(page, destination);
  }
  await page.goto("/dashboard");

  for (const destination of [ACCOUNTS, TRANSACTIONS, BUDGETS]) {
    const link = await prefetchFromShell(page, destination);
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
      await signIn(page);
      await warmDestination(page, destination);
      await page.goto("/dashboard");

      // The prefetch has to go through: a route-level fallback is only instant
      // because Next already holds it, and blocking the prefetch leaves the old
      // page on screen for the whole throttle instead of showing a skeleton
      // (measured — the sweep of this case with the prefetch refused fails
      // outright). So the navigation alone is held back, exactly as in FE-001.
      const link = await prefetchFromShell(page, destination);
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

  await signIn(page);
  await warmDestination(page, CATEGORIES);
  await page.goto("/dashboard");

  // Deliberately no prefetch here: this is the one case that exercises the live
  // `useLinkStatus` hook rather than a jsdom mock of it, so the pending phase
  // has to be real.
  await blockPrefetchAndThrottle(page, CATEGORIES.path);

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
  await signIn(page);
  await warmDestination(page, BUDGETS);
  await page.goto("/dashboard");

  const link = await prefetchFromShell(page, BUDGETS);
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
