import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * GH-14 F7. Everything here is deliberately fixtureless: it must run on every
 * project, on every machine, with an empty environment, because it is the only
 * evidence that the security headers, the accessible structure, the responsive
 * envelope, and both themes actually survive a real browser.
 *
 * No axe or other new dependency — the checks below are hand-rolled against the
 * live DOM.
 */

/** Public routes: reachable with no session, so they are always assertable. */
const PUBLIC_ROUTES = [
  "/",
  "/sign-in",
  "/forgot-password",
  "/install",
  "/offline",
] as const;

const RESPONSIVE_WIDTHS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

/** Mirrors THEME_STORAGE_KEY in src/lib/theme/theme.ts. */
const THEME_STORAGE_KEY = "budget-app-theme";

/** Present on every response, per GH-14 F2. */
const REQUIRED_SECURITY_HEADERS = [
  "content-security-policy",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "x-frame-options",
  "cross-origin-opener-policy",
] as const;

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ animations: "disabled", fullPage: true, path });
  await testInfo.attach(name, { contentType: "image/png", path });
}

test.describe("GH-14 security headers, accessibility, responsiveness, themes", () => {
  test("SEC-001 every response carries the security header table with frame-ancestors 'none'", async ({
    request,
    baseURL,
  }) => {
    const response = await request.get("/");
    expect(response.status()).toBe(200);
    const headers = response.headers();

    for (const header of REQUIRED_SECURITY_HEADERS) {
      expect(
        headers[header],
        `${header} must be present on every response`,
      ).toBeTruthy();
    }

    expect(headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["x-content-type-options"]).toBe("nosniff");

    // HSTS is only meaningful — and only honoured by a browser — over TLS. The
    // E2E base URL is loopback http://127.0.0.1:3100, and an HSTS header on a
    // plain-http response is silently ignored rather than wrong, so its absence
    // here proves nothing either way. Assert the value when the origin is
    // https, and assert only its shape when the server chose to emit it anyway.
    const hsts = headers["strict-transport-security"];
    const isHttps = new URL(baseURL ?? response.url()).protocol === "https:";
    if (isHttps) {
      expect(hsts, "an https origin must carry HSTS").toMatch(/max-age=\d+/);
    } else if (hsts !== undefined) {
      expect(hsts).toMatch(/max-age=\d+/);
    }
  });

  test("SEC-002 the CSP admits the configured Supabase origin and nothing wildcard", async ({
    request,
  }) => {
    const response = await request.get("/");
    const csp = response.headers()["content-security-policy"] ?? "";
    const connectSrc = csp
      .split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("connect-src"));

    expect(connectSrc, "the CSP must declare connect-src").toBeTruthy();
    // A bare `*` in connect-src would readmit every origin the directive exists
    // to exclude; scheme-only sources such as `https:` are just as wide.
    expect(connectSrc).not.toMatch(/(^|\s)\*(\s|$)/);
    expect(connectSrc).not.toMatch(/(^|\s)https:(\s|$)/);
  });

  test("SEC-003 the worker script stays uncacheable and scoped to the whole origin", async ({
    request,
  }) => {
    // A regression here would be a real defect introduced by the header work:
    // a cached worker keeps serving itself and the update prompt never appears.
    const response = await request.get("/sw.js");
    expect(response.status()).toBe(200);

    const headers = response.headers();
    expect(headers["cache-control"]).toContain("no-store");
    expect(headers["service-worker-allowed"]).toBe("/");
    expect(headers["content-type"]).toContain("javascript");
  });

  for (const route of PUBLIC_ROUTES) {
    test(`SEC-004 ${route} has one h1, ordered headings, labelled controls, and alt text`, async ({
      page,
    }) => {
      await page.goto(route);

      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

      const levels = await page
        .locator("h1, h2, h3, h4, h5, h6")
        .evaluateAll((nodes) =>
          nodes.map((node) => Number(node.tagName.slice(1))),
        );
      expect(
        levels.length,
        `${route} must render at least one heading`,
      ).toBeGreaterThan(0);
      expect(levels[0], `${route} must open at h1`).toBe(1);
      for (const [index, level] of levels.entries()) {
        if (index === 0) continue;
        const previous = levels[index - 1] ?? 1;
        expect(
          level - previous,
          `${route} skips from h${previous} to h${level}`,
        ).toBeLessThanOrEqual(1);
      }

      // Accessible name, computed the way a screen reader would reach for it:
      // aria-label, aria-labelledby, an associated or wrapping <label>, or a
      // title. Hidden inputs carry no name and are correctly exempt.
      const unlabelled = await page
        .locator("input:not([type='hidden']), select, textarea")
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => {
              const element = node as HTMLElement;
              if (element.getAttribute("aria-label")?.trim()) return false;
              const labelledBy = element.getAttribute("aria-labelledby");
              if (
                labelledBy
                  ?.split(/\s+/)
                  .some((id) =>
                    document.getElementById(id)?.textContent?.trim(),
                  )
              ) {
                return false;
              }
              const id = element.getAttribute("id");
              if (
                id &&
                document
                  .querySelector(`label[for="${CSS.escape(id)}"]`)
                  ?.textContent?.trim()
              ) {
                return false;
              }
              if (element.closest("label")?.textContent?.trim()) return false;
              if (element.getAttribute("title")?.trim()) return false;
              return true;
            })
            .map((node) => (node as HTMLElement).outerHTML.slice(0, 160)),
        );
      expect(
        unlabelled,
        `every form control on ${route} needs an accessible name`,
      ).toEqual([]);

      expect(
        await page.locator("img:not([alt])").count(),
        `every image on ${route} needs an alt attribute`,
      ).toBe(0);

      // A positive tabindex reorders the whole document's tab sequence and is
      // never the right answer; -1 (programmatic focus) and 0 are fine.
      const positiveTabIndex = await page
        .locator("[tabindex]")
        .evaluateAll((nodes) =>
          nodes
            .map((node) => node.getAttribute("tabindex") ?? "")
            .filter((value) => Number(value) > 0),
        );
      expect(
        positiveTabIndex,
        `${route} must not use a positive tabindex`,
      ).toEqual([]);
    });

    test(`SEC-005 ${route} makes the skip link the first tab stop into its own main`, async ({
      page,
    }) => {
      await page.goto(route);
      await page.keyboard.press("Tab");

      const skipLink = page.getByRole("link", { name: "Skip to content" });
      await expect(skipLink).toBeFocused();

      await page.keyboard.press("Enter");

      // #main-content has to be the route's own <main> landmark. Pointing the
      // skip link at a shell wrapper is the known bug: "skip" then lands above
      // the navigation it exists to bypass.
      const landing = await page.evaluate(() => {
        const target = document.getElementById("main-content");
        const active = document.activeElement;
        return {
          exists: Boolean(target),
          isMainLandmark: target?.tagName.toLowerCase() === "main",
          focusInside: Boolean(
            target && active && (target === active || target.contains(active)),
          ),
        };
      });
      expect(landing.exists, `${route} must render #main-content`).toBe(true);
      expect(
        landing.isMainLandmark,
        `${route} must target its own <main>, not a shell wrapper`,
      ).toBe(true);
      expect(landing.focusInside).toBe(true);
    });
  }

  for (const viewport of RESPONSIVE_WIDTHS) {
    test(`SEC-006 the public surface stays overflow-free at ${viewport.name} width`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });

      for (const route of PUBLIC_ROUTES) {
        await page.goto(route);
        const dimensions = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        // +1 absorbs sub-pixel layout rounding, which is not a real overflow.
        expect(
          dimensions.scrollWidth,
          `${route} overflows horizontally at ${viewport.width}px`,
        ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
      }
    });
  }

  for (const theme of ["light", "dark"] as const) {
    test(`SEC-007 an explicit ${theme} choice resolves before paint`, async ({
      page,
    }, testInfo) => {
      // Load once to own the origin, store the choice, then reload so the
      // inline <head> script applies it during parsing — the real pre-paint
      // path, not a post-hydration toggle.
      await page.goto("/");
      await page.evaluate(
        ([key, value]) => window.localStorage.setItem(key ?? "", value ?? ""),
        [THEME_STORAGE_KEY, theme],
      );
      await page.reload();

      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(
        await page.evaluate(() => document.documentElement.style.colorScheme),
      ).toBe(theme);

      await capture(page, testInfo, `security-hardening-theme-${theme}`);
    });
  }
});
