import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectivityBanner } from "./connectivity-banner";

/** Any currency symbol or cents-precision figure. */
const MONEY = /\$|\d+\.\d{2}/;

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => value,
  });
}

function goOffline() {
  setOnline(false);
  fireEvent(window, new Event("offline"));
}

function goOnline() {
  setOnline(true);
  fireEvent(window, new Event("online"));
}

afterEach(() => {
  Reflect.deleteProperty(window.navigator, "onLine");
  vi.restoreAllMocks();
});

describe("GH-13 connectivity banner (AC7, AC9)", () => {
  it("CB-001 shows no banner while online, but keeps the live region mounted", () => {
    setOnline(true);

    const { container } = render(<ConnectivityBanner />);

    expect(screen.queryByTestId("connectivity-banner")).not.toBeInTheDocument();
    // The region has to pre-exist and be empty: a role="status" element that is
    // inserted with its text already present is not announced.
    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toBeEmptyDOMElement();
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(container.textContent).toBe("");
  });

  it("CB-002 announces the offline state politely with a retry affordance", async () => {
    setOnline(true);
    render(<ConnectivityBanner />);
    const liveRegion = screen.getByRole("status");

    goOffline();

    const banner = await screen.findByTestId("connectivity-banner");
    // Announced because the banner lands *inside* the already-mounted region.
    expect(liveRegion).toContainElement(banner);
    expect(banner).toHaveTextContent(/offline/i);
    expect(
      within(banner).getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });

  it("CB-003 never renders a balance, amount, or currency symbol", async () => {
    setOnline(true);
    render(<ConnectivityBanner />);

    goOffline();

    const banner = await screen.findByTestId("connectivity-banner");
    expect(banner.textContent ?? "").not.toMatch(MONEY);
    expect(banner).not.toHaveTextContent(/balance|transaction|CAD/i);
  });

  it("CB-004 disappears when connectivity returns", async () => {
    setOnline(true);
    render(<ConnectivityBanner />);

    goOffline();
    await screen.findByTestId("connectivity-banner");

    goOnline();

    await waitFor(() =>
      expect(
        screen.queryByTestId("connectivity-banner"),
      ).not.toBeInTheDocument(),
    );
  });

  it("CB-005 shows immediately when the browser is already offline at mount", async () => {
    setOnline(false);

    render(<ConnectivityBanner />);

    await waitFor(() =>
      expect(screen.getByTestId("connectivity-banner")).toBeInTheDocument(),
    );
  });

  it("CB-006 removes every window listener it added on unmount", () => {
    setOnline(true);
    const addEventListener = vi.spyOn(window, "addEventListener");
    const removeEventListener = vi.spyOn(window, "removeEventListener");

    const { unmount } = render(<ConnectivityBanner />);

    const added = addEventListener.mock.calls.filter(
      ([type]) => type === "online" || type === "offline",
    );
    expect(added.map(([type]) => type).sort()).toEqual(["offline", "online"]);

    unmount();

    for (const [type, handler] of added) {
      expect(
        removeEventListener.mock.calls.some(
          ([removedType, removedHandler]) =>
            removedType === type && removedHandler === handler,
        ),
        `no removeEventListener("${String(type)}") for the handler that was added`,
      ).toBe(true);
    }
  });

  it("CB-007 stops reacting to connectivity events once unmounted", () => {
    setOnline(true);
    const { unmount } = render(<ConnectivityBanner />);

    unmount();
    goOffline();

    expect(screen.queryByTestId("connectivity-banner")).not.toBeInTheDocument();
  });
});
