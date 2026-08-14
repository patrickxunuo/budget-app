// @vitest-environment node
// This suite is pure Node: no DOM is needed, and skipping jsdom keeps the
// full-suite memory footprint down.
import { describe, expect, it, vi } from "vitest";

import {
  applyTheme,
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  readStoredPreference,
  resolveTheme,
  THEME_INIT_SCRIPT,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  writeStoredPreference,
  type ThemePreference,
} from "./theme";

function createRoot() {
  return {
    dataset: {} as { theme?: string },
    style: { colorScheme: "" },
  };
}

describe("GH-13 theme preference guard (AC4)", () => {
  it("TH-001 recognizes exactly the three documented preferences", () => {
    expect(THEME_PREFERENCES).toEqual(["system", "light", "dark"]);
    expect(DEFAULT_THEME_PREFERENCE).toBe("system");

    for (const preference of THEME_PREFERENCES) {
      expect(isThemePreference(preference)).toBe(true);
    }

    for (const value of [
      "Dark",
      "LIGHT",
      "auto",
      "",
      " light",
      null,
      undefined,
      0,
      1,
      true,
      {},
      ["light"],
      Symbol("light"),
    ]) {
      expect(isThemePreference(value)).toBe(false);
    }
  });
});

describe("GH-13 stored preference falls back to system (AC4)", () => {
  it("TH-002 returns system when storage is missing entirely", () => {
    expect(readStoredPreference(null)).toBe("system");
    expect(readStoredPreference(undefined)).toBe("system");
  });

  it("TH-003 returns system when the key is absent or holds a bogus value", () => {
    expect(readStoredPreference({ getItem: () => null })).toBe("system");
    expect(readStoredPreference({ getItem: () => "" })).toBe("system");
    expect(readStoredPreference({ getItem: () => "midnight" })).toBe("system");
    expect(readStoredPreference({ getItem: () => "Dark" })).toBe("system");
  });

  it("TH-004 swallows a throwing getItem instead of breaking the page", () => {
    const getItem = vi.fn(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });

    expect(() => readStoredPreference({ getItem })).not.toThrow();
    expect(readStoredPreference({ getItem })).toBe("system");
    expect(getItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
  });

  it("TH-005 reads each stored preference back under the documented key", () => {
    for (const preference of THEME_PREFERENCES) {
      const getItem = vi.fn(() => preference);
      expect(readStoredPreference({ getItem })).toBe(preference);
      expect(getItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
    }
  });
});

describe("GH-13 preference persistence (AC4)", () => {
  it("TH-006 writes the preference under the documented key", () => {
    const setItem = vi.fn();

    writeStoredPreference({ setItem }, "dark");

    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, "dark");
  });

  it("TH-007 tolerates a missing storage object", () => {
    expect(() => writeStoredPreference(null, "light")).not.toThrow();
    expect(() => writeStoredPreference(undefined, "light")).not.toThrow();
  });

  it("TH-008 does not propagate a quota or security failure from setItem", () => {
    const setItem = vi.fn(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });

    expect(() => writeStoredPreference({ setItem }, "light")).not.toThrow();
    expect(setItem).toHaveBeenCalledTimes(1);
  });
});

describe("GH-13 theme resolution (AC4)", () => {
  const cases: Array<[ThemePreference, boolean, "light" | "dark"]> = [
    ["system", false, "light"],
    ["system", true, "dark"],
    ["light", false, "light"],
    ["light", true, "light"],
    ["dark", false, "dark"],
    ["dark", true, "dark"],
  ];

  it.each(cases)(
    "TH-009 resolves %s with prefersDark=%s to %s",
    (preference, prefersDark, expected) => {
      expect(resolveTheme(preference, prefersDark)).toBe(expected);
    },
  );
});

describe("GH-13 theme application (AC4)", () => {
  it("TH-010 leaves data-theme off for system so the device query stays in charge", () => {
    const root = createRoot();
    root.dataset.theme = "dark";

    expect(applyTheme(root, "system", true)).toBe("dark");
    expect(root.dataset.theme).toBeUndefined();
    expect("theme" in root.dataset).toBe(false);
    expect(root.style.colorScheme).toBe("light dark");

    expect(applyTheme(root, "system", false)).toBe("light");
    expect(root.dataset.theme).toBeUndefined();
    expect(root.style.colorScheme).toBe("light dark");
  });

  it("TH-011 pins data-theme and color-scheme for an explicit light choice", () => {
    const root = createRoot();

    expect(applyTheme(root, "light", true)).toBe("light");
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });

  it("TH-012 pins data-theme and color-scheme for an explicit dark choice", () => {
    const root = createRoot();

    expect(applyTheme(root, "dark", false)).toBe("dark");
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
  });
});

describe("GH-13 pre-hydration init script (AC4)", () => {
  it("TH-013 reads the real storage key inside a try/catch", () => {
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
    expect(THEME_INIT_SCRIPT).toMatch(/try\s*\{/);
    expect(THEME_INIT_SCRIPT).toMatch(/catch\s*\(/);
    // Inlined with dangerouslySetInnerHTML: a literal </script> would close the
    // tag early and the rest of the script would render as markup.
    expect(THEME_INIT_SCRIPT).not.toContain("</script");
  });

  it("TH-014 applies a stored dark choice before paint", () => {
    const documentElement = createRoot();
    const run = new Function("localStorage", "document", THEME_INIT_SCRIPT) as (
      storage: unknown,
      doc: unknown,
    ) => void;

    run({ getItem: () => "dark" }, { documentElement });

    expect(documentElement.dataset.theme).toBe("dark");
    expect(documentElement.style.colorScheme).toBe("dark");
  });

  it("TH-015 leaves the document untouched for system, bogus values, and throwing storage", () => {
    const run = new Function("localStorage", "document", THEME_INIT_SCRIPT) as (
      storage: unknown,
      doc: unknown,
    ) => void;

    for (const getItem of [
      () => "system",
      () => null,
      () => "midnight",
      () => {
        throw new Error("storage denied");
      },
    ]) {
      const documentElement = createRoot();
      expect(() => run({ getItem }, { documentElement })).not.toThrow();
      expect(documentElement.dataset.theme).toBeUndefined();
      expect(documentElement.style.colorScheme).toBe("");
    }
  });
});
