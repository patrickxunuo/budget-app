"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

type Platform = "android" | "ios" | "desktop";

/**
 * The subset of the non-standard `beforeinstallprompt` event we rely on. It is
 * Chromium-only, so everything about it is treated as optional.
 */
type InstallPromptEvent = Event & {
  prompt: () => Promise<unknown> | unknown;
  userChoice?: Promise<unknown>;
};

type PlatformSection = {
  platform: Platform;
  testId: string;
  heading: string;
  steps: readonly string[];
};

/**
 * Every platform's instructions ship in the DOM. User-agent detection only
 * decides which one is highlighted, so a wrong or missing guess still leaves a
 * member with complete, readable instructions.
 */
const SECTIONS: readonly PlatformSection[] = [
  {
    platform: "android",
    testId: "install-steps-android",
    heading: "Android and Chromium browsers",
    steps: [
      "Open Budget App in Chrome, Edge, Samsung Internet, or another Chromium browser.",
      "Open the browser menu — the stacked dots at the top right of the window.",
      "Choose “Install app”, or “Add to Home screen” if your browser words it that way.",
      "Confirm. Budget App lands in your app drawer and opens in its own window.",
    ],
  },
  {
    platform: "ios",
    testId: "install-steps-ios",
    heading: "iPhone and iPad (Safari)",
    steps: [
      "Open Budget App in Safari. Home-screen installation is a Safari feature on iOS and iPadOS.",
      "Tap the Share button in the toolbar — the square with an arrow pointing up.",
      "Scroll the share sheet and choose “Add to Home Screen”.",
      "Name the icon, then tap Add. Budget App launches without Safari's browser chrome.",
    ],
  },
  {
    platform: "desktop",
    testId: "install-steps-desktop",
    heading: "Desktop Chrome, Edge, and Brave",
    steps: [
      "Open Budget App in Chrome, Edge, or Brave.",
      "Look for the install icon at the right-hand end of the address bar.",
      "If it is hidden, open the browser menu and choose “Install Budget App”.",
      "The installed copy opens in its own window and can be pinned to the taskbar or dock.",
    ],
  },
];

/**
 * iPadOS reports a desktop Macintosh user agent, so touch points are the only
 * reliable tell. Returning `null` means "no idea" and leaves every section
 * equally presented rather than guessing wrong.
 */
function detectPlatform(): Platform | null {
  if (typeof navigator === "undefined") return null;
  const agent = navigator.userAgent;
  if (typeof agent !== "string" || agent.length === 0) return null;
  if (/iphone|ipad|ipod/i.test(agent)) return "ios";
  if (
    /macintosh|mac os x/i.test(agent) &&
    (navigator.maxTouchPoints ?? 0) > 1
  ) {
    return "ios";
  }
  if (/android/i.test(agent)) return "android";
  return "desktop";
}

/** True once the app is running from the home screen instead of a browser tab. */
function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  } catch {
    // matchMedia can be absent or throw in embedded webviews.
  }
  if (typeof navigator === "undefined") return false;
  // Safari's pre-standard flag, still the only signal on iOS.
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** The user agent never changes for the life of a document. */
const subscribeToNothing = () => () => {};

function subscribeToDisplayMode(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  let media: MediaQueryList | null = null;
  try {
    media = window.matchMedia?.("(display-mode: standalone)") ?? null;
  } catch {
    media = null;
  }
  media?.addEventListener?.("change", onChange);
  return () => media?.removeEventListener?.("change", onChange);
}

export function InstallGuidance() {
  // Both readings are browser-only. `useSyncExternalStore` gives the server and
  // the hydration pass the neutral snapshot — no platform marked, not installed
  // — and swaps in the detected value immediately after mount, so nothing here
  // can produce a hydration mismatch.
  const platform = useSyncExternalStore<Platform | null>(
    subscribeToNothing,
    detectPlatform,
    () => null,
  );
  const standalone = useSyncExternalStore(
    subscribeToDisplayMode,
    detectStandalone,
    () => false,
  );
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(
    null,
  );

  useEffect(() => {
    const capture = (event: Event) => {
      // Suppressing the browser's own mini-infobar is what lets us offer the
      // install action from a deliberate, labelled button instead.
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", capture);
    return () => window.removeEventListener("beforeinstallprompt", capture);
  }, []);

  const install = async () => {
    if (!installEvent) return;
    try {
      await installEvent.prompt();
      if (installEvent.userChoice) await installEvent.userChoice;
    } catch {
      // A dismissed or already-consumed prompt is not an error worth showing.
    } finally {
      // The event is single-use: the browser fires a fresh one if it still
      // considers the app installable.
      setInstallEvent(null);
    }
  };

  return (
    <div data-testid="install-guidance" className="flex flex-col gap-5">
      {installEvent ? (
        <div className="border-line bg-panel rounded-2xl border p-5">
          <p className="text-muted text-sm leading-6">
            Your browser can install Budget App directly from this page.
          </p>
          <button
            type="button"
            data-testid="install-prompt-button"
            onClick={install}
            className="bg-brand text-on-accent hover:bg-brand-strong focus-visible:outline-focus mt-4 inline-flex min-h-11 items-center rounded-xl px-5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            Install Budget App
          </button>
        </div>
      ) : null}

      {standalone ? (
        <section
          data-testid="install-already-installed"
          className="border-line bg-surface rounded-2xl border p-6"
        >
          <p className="font-utility text-brand text-[.65rem] font-semibold tracking-[.12em] uppercase">
            Installed
          </p>
          <h2 className="font-display text-ink mt-3 text-2xl font-semibold tracking-[-.04em]">
            Budget App is already installed.
          </h2>
          <p className="text-muted mt-3 text-sm leading-6">
            You are running Budget App in its own window from your home screen
            or app list, so there is nothing left to install here. Every figure
            it shows still comes from the network.
          </p>
        </section>
      ) : (
        SECTIONS.map((section) => {
          const current = platform === section.platform;
          return (
            <section
              key={section.platform}
              data-testid={section.testId}
              data-current={current ? "true" : undefined}
              className={`bg-surface rounded-2xl border p-6 ${
                current ? "border-brand" : "border-line-soft"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-ink text-xl font-semibold tracking-[-.03em]">
                  {section.heading}
                </h2>
                {current ? (
                  <span className="border-brand bg-brand text-on-accent font-utility rounded-full border px-3 py-1 text-[.62rem] font-semibold tracking-[.12em] uppercase">
                    Your device
                  </span>
                ) : null}
              </div>
              <ol className="divide-line-soft mt-4 divide-y">
                {section.steps.map((step, position) => (
                  <li
                    key={step}
                    className="grid grid-cols-[2rem_1fr] gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span
                      aria-hidden="true"
                      className="font-utility text-brand text-[.65rem] font-semibold tracking-[.12em]"
                    >
                      {String(position + 1).padStart(2, "0")}
                    </span>
                    <span className="text-muted text-sm leading-6">{step}</span>
                  </li>
                ))}
              </ol>
            </section>
          );
        })
      )}
    </div>
  );
}
