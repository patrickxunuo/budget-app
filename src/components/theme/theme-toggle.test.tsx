import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_STORAGE_KEY } from "@/lib/theme/theme";

import { ThemeToggle } from "./theme-toggle";

function setPrefersDark(prefersDark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: prefersDark && query.includes("prefers-color-scheme: dark"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function root() {
  return document.documentElement;
}

beforeEach(() => {
  window.localStorage.clear();
  setPrefersDark(false);
  root().removeAttribute("data-theme");
  root().style.colorScheme = "";
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  root().removeAttribute("data-theme");
  root().style.colorScheme = "";
});

describe("GH-13 appearance control (AC4, AC5)", () => {
  it("TT-001 is one compact, accessible theme button", () => {
    render(<ThemeToggle />);

    const toggle = screen.getByRole("button", {
      name: /switch to dark theme/i,
    });
    expect(toggle).toHaveAttribute("data-theme-icon", "sun");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("TT-002 follows the device until the member makes a choice", () => {
    render(<ThemeToggle />);

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  it("TT-003 reflects a stored Dark preference with a moon icon", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    render(<ThemeToggle />);

    const toggle = screen.getByRole("button", {
      name: /switch to light theme/i,
    });
    expect(toggle).toHaveAttribute("data-theme-icon", "moon");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(root().getAttribute("data-theme")).toBe("dark");
    expect(root().style.colorScheme).toBe("dark");
  });

  it("TT-004 persists and paints an explicit Dark choice", () => {
    render(<ThemeToggle />);

    fireEvent.click(
      screen.getByRole("button", { name: /switch to dark theme/i }),
    );

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(root().getAttribute("data-theme")).toBe("dark");
    expect(root().style.colorScheme).toBe("dark");
    expect(
      screen.getByRole("button", { name: /switch to light theme/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("TT-005 switches a stored Dark preference to Light", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeToggle />);

    fireEvent.click(
      screen.getByRole("button", { name: /switch to light theme/i }),
    );

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(root().getAttribute("data-theme")).toBe("light");
    expect(root().style.colorScheme).toBe("light");
  });

  it("TT-006 keeps working when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });

    expect(() => render(<ThemeToggle />)).not.toThrow();

    expect(() =>
      fireEvent.click(
        screen.getByRole("button", { name: /switch to dark theme/i }),
      ),
    ).not.toThrow();
    expect(
      screen.getByRole("button", { name: /switch to light theme/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(root().getAttribute("data-theme")).toBe("dark");
  });

  it("TT-007 tracks a dark device theme without writing a preference", async () => {
    setPrefersDark(true);
    render(<ThemeToggle />);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /switch to light theme/i }),
      ).toHaveAttribute("data-theme-icon", "moon"),
    );
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
});
