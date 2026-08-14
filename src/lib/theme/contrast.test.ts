// @vitest-environment node
// This suite is pure Node: no DOM is needed, and skipping jsdom keeps the
// full-suite memory footprint down.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AA_LARGE_OR_UI_RATIO,
  AA_TEXT_RATIO,
  contrastRatio,
  parseCssCustomProperties,
  parseCssCustomPropertyBlocks,
  parseHexColor,
  relativeLuminance,
} from "./contrast";

const GLOBALS_CSS_PATH = join(process.cwd(), "src", "app", "globals.css");
const css = readFileSync(GLOBALS_CSS_PATH, "utf8");

/** Tokens painted as body-size text, which owe 4.5:1. */
const TEXT_TOKENS = [
  "--ink",
  "--muted",
  "--brand",
  "--brand-strong",
  "--mineral",
  "--alert",
];

/** Tokens that bound or outline a control, which owe 3:1. */
const UI_TOKENS = ["--line", "--focus"];

/** Every backdrop a token can land on. */
const SURFACE_TOKENS = ["--background", "--surface", "--panel"];

/** Fills that `--on-accent` is printed over. */
const ACCENT_TOKENS = ["--brand", "--brand-strong", "--mineral", "--alert"];

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

type Palette = Record<string, string>;

const lightPalette = parseCssCustomProperties(css, ':root[data-theme="light"]');
const darkPalette = parseCssCustomProperties(css, ':root[data-theme="dark"]');

const palettes: Array<[string, Palette]> = [
  ["light", lightPalette],
  ["dark", darkPalette],
];

function token(palette: Palette, name: string): string {
  const value = palette[name];
  if (!value) throw new Error(`Palette is missing ${name}`);
  return value;
}

type PairCase = [string, string, string, Palette];

function pairs(tokens: string[], surfaces: string[]): PairCase[] {
  return palettes.flatMap(([theme, palette]) =>
    tokens.flatMap((foreground) =>
      surfaces.map((background): PairCase => [
        theme,
        foreground,
        background,
        palette,
      ]),
    ),
  );
}

describe("GH-13 hex parsing", () => {
  it("CT-001 expands 3-digit and reads 6-digit hex colours", () => {
    expect(parseHexColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor("#000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHexColor("#0A3")).toEqual({ r: 0, g: 170, b: 51 });
    expect(parseHexColor("#176044")).toEqual({ r: 23, g: 96, b: 68 });
    expect(parseHexColor("  #E8EEE9  ")).toEqual({ r: 232, g: 238, b: 233 });
  });

  it("CT-002 throws on anything that is not a 3- or 6-digit hex colour", () => {
    for (const value of [
      "",
      "#",
      "fff",
      "#ff",
      "#ffff",
      "#fffff",
      "#fffffff",
      "#gggggg",
      "#12345g",
      "rgb(0,0,0)",
      "var(--ink)",
      "transparent",
    ]) {
      expect(() => parseHexColor(value)).toThrow();
    }
  });
});

describe("GH-13 WCAG 2.1 contrast maths", () => {
  it("CT-003 computes the reference relative luminances", () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 10);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 10);
    expect(relativeLuminance({ r: 255, g: 0, b: 0 })).toBeCloseTo(0.2126, 4);
    expect(relativeLuminance({ r: 0, g: 255, b: 0 })).toBeCloseTo(0.7152, 4);
    expect(relativeLuminance({ r: 0, g: 0, b: 255 })).toBeCloseTo(0.0722, 4);
  });

  it("CT-004 anchors the ratio scale at 21:1 and 1:1", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 10);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 10);
    expect(contrastRatio("#176044", "#176044")).toBeCloseTo(1, 10);
    expect(contrastRatio("#fff", "#ffffff")).toBeCloseTo(1, 10);
  });

  it("CT-005 is symmetric and stays inside 1..21", () => {
    for (const [a, b] of [
      ["#14231c", "#e8eee9"],
      ["#67c79b", "#0c1712"],
      ["#9a4636", "#f8faf7"],
    ]) {
      const ratio = contrastRatio(a as string, b as string);
      expect(ratio).toBeCloseTo(contrastRatio(b as string, a as string), 12);
      expect(ratio).toBeGreaterThanOrEqual(1);
      expect(ratio).toBeLessThanOrEqual(21);
    }
  });

  it("CT-006 keeps the AA thresholds at the published values", () => {
    expect(AA_TEXT_RATIO).toBe(4.5);
    expect(AA_LARGE_OR_UI_RATIO).toBe(3);
  });
});

describe("GH-13 CSS custom-property reader", () => {
  it("CT-007 lists innermost declaring rules in source order", () => {
    const blocks = parseCssCustomPropertyBlocks(
      `:root { --a: #fff; --b: #000; }
       @media (prefers-color-scheme: dark) {
         :root { --a: #111; }
       }
       .no-tokens { color: red; }
       :root[data-theme="dark"] { --a: #222; }`,
    );

    expect(blocks).toEqual([
      { selector: ":root", properties: { "--a": "#fff", "--b": "#000" } },
      { selector: ":root", properties: { "--a": "#111" } },
      { selector: ':root[data-theme="dark"]', properties: { "--a": "#222" } },
    ]);
  });

  it("CT-008 reports a rule's own selector when an at-statement precedes it", () => {
    // Regression guard: globals.css opens with `@import "tailwindcss";`. A
    // greedy selector capture glues that statement onto the first `:root`,
    // which silently shifts every `:root` occurrence index by one and makes
    // the device-preference palette unreachable.
    expect(
      parseCssCustomPropertyBlocks(
        `@import "tailwindcss";\n\n:root { --a: #fff; }`,
      ),
    ).toEqual([{ selector: ":root", properties: { "--a": "#fff" } }]);
  });

  it("CT-009 ignores commented-out tokens", () => {
    expect(
      parseCssCustomPropertyBlocks(
        `:root { --live: #fff; /* --dead: #000; */ }`,
      ),
    ).toEqual([{ selector: ":root", properties: { "--live": "#fff" } }]);
  });

  it("CT-010 selects the nth rule for a selector and throws when it is absent", () => {
    const sample = `:root { --a: #111; }
      @media (prefers-color-scheme: dark) { :root { --a: #222; } }`;

    expect(parseCssCustomProperties(sample, ":root")).toEqual({
      "--a": "#111",
    });
    expect(parseCssCustomProperties(sample, ":root", 2)).toEqual({
      "--a": "#222",
    });
    expect(() => parseCssCustomProperties(sample, ":root", 3)).toThrow(/:root/);
    expect(() => parseCssCustomProperties(sample, ".missing")).toThrow();
  });
});

describe("GH-13 palette is complete in both themes (AC5)", () => {
  it.each(palettes)(
    "CT-011 %s declares every audited token",
    (_theme, palette) => {
      for (const name of [
        ...SURFACE_TOKENS,
        ...TEXT_TOKENS,
        ...UI_TOKENS,
        "--on-accent",
      ]) {
        expect(palette[name], `${name} is missing`).toMatch(HEX);
      }
    },
  );
});

describe("GH-13 WCAG AA text contrast (AC5)", () => {
  it.each(pairs(TEXT_TOKENS, SURFACE_TOKENS))(
    "CT-012 %s: %s on %s reaches 4.5:1",
    (_theme, foreground, background, palette) => {
      expect(
        contrastRatio(token(palette, foreground), token(palette, background)),
      ).toBeGreaterThanOrEqual(AA_TEXT_RATIO);
    },
  );
});

describe("GH-13 WCAG AA non-text contrast (AC5)", () => {
  it.each(pairs(UI_TOKENS, SURFACE_TOKENS))(
    "CT-013 %s: %s on %s reaches 3:1",
    (_theme, foreground, background, palette) => {
      expect(
        contrastRatio(token(palette, foreground), token(palette, background)),
      ).toBeGreaterThanOrEqual(AA_LARGE_OR_UI_RATIO);
    },
  );
});

describe("GH-13 WCAG AA accent foreground contrast (AC5)", () => {
  it.each(pairs(["--on-accent"], ACCENT_TOKENS))(
    "CT-014 %s: %s on %s reaches 4.5:1",
    (_theme, foreground, background, palette) => {
      expect(
        contrastRatio(token(palette, foreground), token(palette, background)),
      ).toBeGreaterThanOrEqual(AA_TEXT_RATIO);
    },
  );
});

describe("GH-13 device palette cannot drift from the explicit palette (AC4, AC5)", () => {
  it("CT-015 the authored :root default matches the explicit light theme", () => {
    expect(parseCssCustomProperties(css, ":root", 1)).toEqual(lightPalette);
  });

  it("CT-016 the prefers-color-scheme: dark :root matches the explicit dark theme", () => {
    expect(parseCssCustomProperties(css, ":root", 2)).toEqual(darkPalette);
  });

  it("CT-017 the two themes are genuinely different palettes", () => {
    expect(lightPalette).not.toEqual(darkPalette);
  });
});
