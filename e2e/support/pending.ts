import { expect, type Locator } from "@playwright/test";

/**
 * Starts observing before activation so even a fast real-backend response
 * cannot hide the transient accessible pending state. This observes the real
 * DOM only; it never delays, intercepts, or replaces the request.
 */
export async function activateAndObservePending(
  control: Locator,
  activate: () => Promise<void>,
) {
  const pendingObserved = control.evaluate(
    (element) =>
      new Promise<boolean>((resolve) => {
        let settled = false;
        const cleanup: {
          observer?: MutationObserver;
          timeout?: number;
        } = {};
        const isPending = () =>
          element.getAttribute("aria-busy") === "true" &&
          element.hasAttribute("disabled");
        const settle = (observed: boolean) => {
          if (settled) return;
          settled = true;
          cleanup.observer?.disconnect();
          if (cleanup.timeout !== undefined)
            window.clearTimeout(cleanup.timeout);
          element.removeEventListener("gh33-pending-observer-cancel", cancel);
          resolve(observed);
        };
        const cancel = () => settle(false);

        if (isPending()) {
          settle(true);
          return;
        }

        cleanup.observer = new MutationObserver(() => {
          if (!isPending()) return;
          settle(true);
        });
        cleanup.observer.observe(element, {
          attributes: true,
          attributeFilter: ["aria-busy", "disabled"],
        });
        element.addEventListener("gh33-pending-observer-cancel", cancel);
        cleanup.timeout = window.setTimeout(() => settle(false), 5_000);
      }),
  );

  try {
    await activate();
  } catch (error) {
    await control
      .evaluate((element) =>
        element.dispatchEvent(new Event("gh33-pending-observer-cancel")),
      )
      .catch(() => undefined);
    await pendingObserved.catch(() => undefined);
    throw error;
  }
  expect(await pendingObserved).toBe(true);
}
