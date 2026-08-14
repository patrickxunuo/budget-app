import type { Page } from "@playwright/test";

/**
 * The headers a browser attaches to a same-origin state-changing fetch.
 *
 * `page.request` shares the page's cookies, but it is not the browser's own
 * `fetch`: it sends no `Origin`, no `Referer`, and no `Sec-Fetch-Site`. The
 * origin gate in `src/lib/security/origin.ts` fails closed when all three are
 * absent — a deliberate posture, because every browser sends at least one of
 * them on a write, so their joint absence means a stripped proxy or a
 * hand-rolled request rather than in-page JavaScript.
 *
 * A spec that uses `page.request` to stand in for a call the application's own
 * client code would make therefore has to supply them itself. Without this the
 * request comes back 403 `invalid_origin`, which reads like a permissions bug
 * and is really the harness under-emulating the browser.
 *
 * Do not use this to reach an endpoint the UI cannot reach; it exists to make
 * `page.request` behave like the app's client, not to bypass the gate.
 */
export function sameOriginHeaders(page: Page): Record<string, string> {
  const current = page.url();
  if (!/^https?:/i.test(current)) {
    throw new Error(
      `sameOriginHeaders() needs a navigated page, but the page is at "${current}". Call it after page.goto() or a sign-in helper.`,
    );
  }
  return {
    origin: new URL(current).origin,
    "sec-fetch-site": "same-origin",
  };
}
