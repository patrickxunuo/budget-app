import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InstallGuidance } from "./install-guidance";

const IOS_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_AGENT =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const DESKTOP_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const SECTION_IDS = [
  "install-steps-android",
  "install-steps-ios",
  "install-steps-desktop",
];

function setUserAgent(agent: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    get: () => agent,
  });
}

function setStandalone(standalone: boolean) {
  const matchMedia = vi.fn((query: string) => ({
    matches: standalone && query.includes("display-mode: standalone"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: matchMedia,
  });
}

function fireBeforeInstallPrompt() {
  const event = new Event("beforeinstallprompt") as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: string; platform: string }>;
  };
  event.prompt = vi.fn(async () => undefined);
  event.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });
  fireEvent(window, event);
  return event;
}

beforeEach(() => {
  setStandalone(false);
  setUserAgent(DESKTOP_AGENT);
});

afterEach(() => {
  Reflect.deleteProperty(window.navigator, "userAgent");
  vi.restoreAllMocks();
});

describe("GH-13 every platform's steps ship in the DOM (AC2)", () => {
  it.each([
    ["iOS", IOS_AGENT],
    ["Android", ANDROID_AGENT],
    ["desktop", DESKTOP_AGENT],
    ["an unreadable user agent", ""],
  ])("IG-001 renders all three sections on %s", (_label, agent) => {
    setUserAgent(agent);

    render(<InstallGuidance />);

    for (const testId of SECTION_IDS) {
      const section = screen.getByTestId(testId);
      expect(
        within(section).getByRole("heading", { level: 2 }),
      ).toBeInTheDocument();
      expect(within(section).getAllByRole("listitem").length).toBeGreaterThan(
        1,
      );
    }
  });

  it("IG-002 marks only the matching platform as the current one", async () => {
    setUserAgent(IOS_AGENT);

    render(<InstallGuidance />);

    await waitFor(() =>
      expect(screen.getByTestId("install-steps-ios")).toHaveAttribute(
        "data-current",
        "true",
      ),
    );
    const ios = screen.getByTestId("install-steps-ios");
    expect(within(ios).getByText(/your device/i)).toBeVisible();

    for (const testId of ["install-steps-android", "install-steps-desktop"]) {
      const section = screen.getByTestId(testId);
      expect(section).not.toHaveAttribute("data-current", "true");
      expect(within(section).queryByText(/your device/i)).toBeNull();
    }
  });

  it("IG-003 spells out the iOS Share sheet route", () => {
    setUserAgent(IOS_AGENT);

    render(<InstallGuidance />);

    const ios = screen.getByTestId("install-steps-ios");
    expect(ios).toHaveTextContent(/share/i);
    expect(ios).toHaveTextContent(/add to home screen/i);
    expect(ios).toHaveTextContent(/safari/i);
  });

  it("IG-004 highlights nothing when the platform cannot be detected", async () => {
    setUserAgent("");

    render(<InstallGuidance />);

    await waitFor(() =>
      expect(screen.getByTestId("install-steps-ios")).toBeInTheDocument(),
    );
    for (const testId of SECTION_IDS) {
      expect(screen.getByTestId(testId)).not.toHaveAttribute(
        "data-current",
        "true",
      );
    }
    expect(screen.queryByText(/your device/i)).toBeNull();
  });
});

describe("GH-13 already-installed state (AC2)", () => {
  it("IG-005 replaces the instructions when running in standalone display mode", async () => {
    setStandalone(true);

    render(<InstallGuidance />);

    await waitFor(() =>
      expect(screen.getByTestId("install-already-installed")).toBeVisible(),
    );
    for (const testId of SECTION_IDS) {
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
    }
  });
});

describe("GH-13 browser install prompt (AC2)", () => {
  it("IG-006 renders no install button until the browser offers one", () => {
    render(<InstallGuidance />);

    expect(
      screen.queryByTestId("install-prompt-button"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /install budget app/i }),
    ).not.toBeInTheDocument();
  });

  it("IG-007 shows a labelled install button once beforeinstallprompt fires and calls prompt()", async () => {
    render(<InstallGuidance />);

    const event = fireBeforeInstallPrompt();

    const button = await screen.findByTestId("install-prompt-button");
    expect(button).toHaveAccessibleName(/install budget app/i);

    fireEvent.click(button);

    await waitFor(() => expect(event.prompt).toHaveBeenCalledTimes(1));
  });
});
