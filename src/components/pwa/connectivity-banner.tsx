"use client";

import { useEffect, useState } from "react";

/**
 * `navigator.onLine` is absent during server rendering and can be `undefined`
 * in exotic embeddings; both are treated as online so the banner stays out of
 * the server-rendered HTML and never flashes on a healthy connection.
 */
function readOnlineState(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

/**
 * A polite, always-mounted connectivity notice. It carries no figures at all:
 * Budget App deliberately stores nothing about a member's money on the device,
 * so there is nothing to show while the network is gone — only an explanation
 * and a way to retry.
 */
export function ConnectivityBanner() {
  const [online, setOnline] = useState(readOnlineState);

  useEffect(() => {
    // Only the browser's own events flip this: the lazy initializer above has
    // already read the current state, and re-reading it here would be a
    // cascading render for no benefit.
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return (
    // The live region is mounted on every page, empty, and stays mounted. A
    // `role="status"` element that appears already populated is not announced
    // by screen readers — the region has to be in the accessibility tree
    // *before* its contents change. Empty it carries no styling, so it costs
    // nothing visually. Only the inner banner comes and goes.
    // `sticky` belongs on the always-mounted wrapper: a sticky element can only
    // travel within its own parent's box, and the inner banner fills this one
    // exactly, so pinning it there would never actually pin.
    <div role="status" aria-live="polite" className="sticky top-0 z-50">
      {online ? null : (
        <div
          data-testid="connectivity-banner"
          className="safe-top border-line bg-panel text-ink w-full border-b"
        >
          <div className="mx-auto flex w-full max-w-[88rem] flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 sm:px-8">
            {/* Shape plus word: the state never depends on the colour alone. */}
            <span className="font-utility text-alert inline-flex shrink-0 items-center gap-2 text-[.65rem] font-semibold tracking-[.12em] uppercase">
              <svg
                viewBox="0 0 20 20"
                aria-hidden="true"
                focusable="false"
                className="size-4 shrink-0"
              >
                <path
                  d="M10 2.2 18.6 17.4H1.4z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <path
                  d="M10 7.4v4M10 14.1v.9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
              Offline
            </span>
            {/* Deliberately free of every figure and of the words that name one:
            there is nothing to show here, only an explanation. */}
            <p className="text-muted min-w-0 flex-1 text-xs leading-5">
              This device is offline. Budget App deliberately keeps no financial
              data on the device, so your figures come back as soon as the
              connection does.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="border-line text-ink hover:border-brand hover:text-brand focus-visible:outline-focus inline-flex min-h-11 shrink-0 items-center rounded-xl border px-4 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
