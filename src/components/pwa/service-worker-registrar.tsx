"use client";

import { useEffect, useRef, useState } from "react";

type ServiceWorkerRegistrarProps = {
  enabled?: boolean;
  scriptUrl?: string;
};

/**
 * Registers `public/sw.js` and surfaces an explicit, accessible prompt when a
 * newer worker is waiting.
 *
 * Registration is off outside production because the worker serves
 * `/_next/static/**` cache-first: in `next dev` that would hand back stale
 * development chunks after every edit. The flag is a default parameter rather
 * than a module constant so a test can force it on.
 */
export function ServiceWorkerRegistrar({
  enabled = process.env.NODE_ENV === "production",
  scriptUrl = "/sw.js",
}: ServiceWorkerRegistrarProps = {}) {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);
  /** Set only by "Refresh now": nothing else may trigger a reload. */
  const updateRequested = useRef(false);
  /** Latches the single permitted reload so an update can never loop. */
  const reloaded = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const container = navigator.serviceWorker;
    if (!container) return;

    let cancelled = false;

    const handleControllerChange = () => {
      // A first-ever installation also fires this event; reloading then would
      // be a pointless flash, and reloading twice would be a loop.
      if (!updateRequested.current || reloaded.current) return;
      reloaded.current = true;
      window.location.reload();
    };

    const promote = (worker: ServiceWorker | null | undefined) => {
      if (cancelled || !worker) return;
      // No controller means this is the first install, not an update: there is
      // no stale UI on screen to replace, so there is nothing to announce.
      if (!container.controller) return;
      setWaiting(worker);
      setDismissed(false);
    };

    container.addEventListener?.("controllerchange", handleControllerChange);

    void (async () => {
      try {
        const registration = await container.register(scriptUrl, {
          scope: "/",
          updateViaCache: "none",
        });
        if (cancelled || !registration) return;

        registration.addEventListener?.("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener?.("statechange", () => {
            if (installing.state !== "installed") return;
            promote(registration.waiting ?? installing);
          });
        });

        // A worker can already be parked before this page ever loaded.
        promote(registration.waiting);
      } catch {
        // A blocked, unsupported, or failed registration is not worth breaking
        // the page over: the app works perfectly well without a worker.
      }
    })();

    return () => {
      cancelled = true;
      container.removeEventListener?.(
        "controllerchange",
        handleControllerChange,
      );
    };
  }, [enabled, scriptUrl]);

  // Only `enabled` may gate the markup. Branching on `navigator` here would
  // render nothing on the server and the live region on the client, which is a
  // hydration mismatch on every page load; the effect above already refuses to
  // register where service workers are unsupported.
  if (!enabled) return null;

  const refresh = () => {
    updateRequested.current = true;
    try {
      // The worker only calls skipWaiting() when a page asks for it, so this
      // message is the sole path from "waiting" to "active".
      waiting?.postMessage?.({ type: "SKIP_WAITING" });
    } catch {
      // An already-redundant worker throws here; the prompt simply does
      // nothing rather than surfacing an error to the member.
    }
  };

  return (
    // Same reasoning as the connectivity banner: the live region is mounted
    // empty from the start, because a `role="status"` node that arrives with
    // its text already in place is not announced.
    <div role="status" aria-live="polite">
      {!waiting || dismissed ? null : (
        <div
          data-testid="sw-update-prompt"
          className="border-line bg-surface text-ink fixed right-4 bottom-[calc(5.5rem_+_env(safe-area-inset-bottom,0px))] left-4 z-50 mx-auto max-w-md rounded-2xl border p-4 shadow-[0_18px_40px_rgba(17,34,27,0.18)] lg:right-6 lg:bottom-6 lg:left-auto"
        >
          <p className="font-utility text-brand text-[.62rem] font-semibold tracking-[.12em] uppercase">
            Update ready
          </p>
          <p className="text-ink mt-2 text-sm leading-6 font-semibold">
            A new version of Budget App is ready.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="sw-update-refresh"
              onClick={refresh}
              className="bg-brand text-on-accent hover:bg-brand-strong focus-visible:outline-focus inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Refresh now
            </button>
            <button
              type="button"
              data-testid="sw-update-dismiss"
              onClick={() => setDismissed(true)}
              className="border-line text-ink hover:border-brand hover:text-brand focus-visible:outline-focus inline-flex min-h-11 items-center rounded-xl border px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Later
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
