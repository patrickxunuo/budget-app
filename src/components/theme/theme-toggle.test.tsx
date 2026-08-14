import { fireEvent, render, screen } from "@testing-library/react";
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
  it("TT-001 is a labelled radio group offering System, Light, and Dark", () => {
    render(<ThemeToggle />);

    const group = screen.getByRole("group", { name: /appearance/i });
    expect(group).toBeInTheDocument();
    for (const label of ["System", "Light", "Dark"]) {
      expect(
        screen.getByRole("radio", { name: new RegExp(`^${label}$`, "i") }),
      ).toBeInTheDocument();
    }
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("TT-002 defaults to System when nothing is stored", () => {
    render(<ThemeToggle />);

    expect(screen.getByRole("radio", { name: /^system$/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^light$/i })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /^dark$/i })).not.toBeChecked();
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  it("TT-003 reflects a stored Dark preference as the selected option", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    render(<ThemeToggle />);

    expect(screen.getByRole("radio", { name: /^dark$/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^system$/i })).not.toBeChecked();
    expect(root().getAttribute("data-theme")).toBe("dark");
    expect(root().style.colorScheme).toBe("dark");
  });

  it("TT-004 persists and paints an explicit Light choice", () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("radio", { name: /^light$/i }));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(root().getAttribute("data-theme")).toBe("light");
    expect(root().style.colorScheme).toBe("light");
    expect(screen.getByRole("radio", { name: /^light$/i })).toBeChecked();
  });

  it("TT-005 hands control back to the device when System is chosen", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeToggle />);
    expect(root().getAttribute("data-theme")).toBe("dark");

    fireEvent.click(screen.getByRole("radio", { name: /^system$/i }));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    expect(root().hasAttribute("data-theme")).toBe(false);
    expect(root().style.colorScheme).toBe("light dark");
    expect(screen.getByRole("radio", { name: /^system$/i })).toBeChecked();
  });

  it("TT-006 keeps working when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });

    expect(() => render(<ThemeToggle />)).not.toThrow();

    expect(screen.getByRole("radio", { name: /^system$/i })).toBeChecked();
    expect(() =>
      fireEvent.click(screen.getByRole("radio", { name: /^dark$/i })),
    ).not.toThrow();
    expect(screen.getByRole("radio", { name: /^dark$/i })).toBeChecked();
    expect(root().getAttribute("data-theme")).toBe("dark");
  });

  it("TT-007 conveys the selected option with more than colour", () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("radio", { name: /^dark$/i }));

    const selected = screen.getByRole("radio", { name: /^dark$/i });
    expect(selected).toBeChecked();
    expect(selected).toHaveAttribute("type", "radio");
    // The checked state is exposed to assistive technology by the radio itself,
    // not by the label's fill colour.
    expect(screen.getByRole("radio", { name: /^light$/i })).not.toBeChecked();
  });
});
