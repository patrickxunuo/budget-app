/**
 * WCAG 2.1 contrast maths plus a small CSS custom-property reader, so the
 * palette in `src/app/globals.css` can be asserted against AA thresholds
 * directly instead of being audited by hand.
 */

export type Rgb = { r: number; g: number; b: number };

/** WCAG AA minimum for body-size text. */
export const AA_TEXT_RATIO = 4.5;
/** WCAG AA minimum for large text, UI components, and graphical objects. */
export const AA_LARGE_OR_UI_RATIO = 3;

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function parseHexColor(value: string): Rgb {
  const hex = value.trim();
  if (!HEX_PATTERN.test(hex)) {
    throw new Error(`Expected a 3- or 6-digit hex colour, received "${value}"`);
  }
  const digits = hex.slice(1);
  const expanded =
    digits.length === 3
      ? digits
          .split("")
          .map((d) => d + d)
          .join("")
      : digits;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: Rgb): number {
  return (
    0.2126 * channelLuminance(color.r) +
    0.7152 * channelLuminance(color.g) +
    0.0722 * channelLuminance(color.b)
  );
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(parseHexColor(foreground));
  const b = relativeLuminance(parseHexColor(background));
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

export type CustomPropertyBlock = {
  selector: string;
  properties: Record<string, string>;
};

/**
 * Lists every innermost rule that declares custom properties, in source order.
 * A rule nested in an at-rule reports its own selector, so the `:root` inside
 * `@media (prefers-color-scheme: dark)` appears as a second `:root` block —
 * which is how the device-preference palette is reached. Comments are stripped
 * first so a commented-out token cannot be mistaken for a live one.
 */
export function parseCssCustomPropertyBlocks(
  css: string,
): CustomPropertyBlock[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks: CustomPropertyBlock[] = [];
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const rawSelector = match[1] ?? "";
    const body = match[2] ?? "";
    const properties: Record<string, string> = {};
    for (const declaration of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      const name = declaration[1];
      const value = declaration[2];
      if (name && value) properties[name] = value.trim();
    }
    if (Object.keys(properties).length > 0) {
      // The selector capture reaches back to the previous `}`, so it can pick
      // up a preceding statement such as `@import "tailwindcss";`. Everything
      // up to the last `;` belongs to that statement, never to the selector.
      const selector = rawSelector.slice(rawSelector.lastIndexOf(";") + 1);
      blocks.push({ selector: selector.trim(), properties });
    }
  }
  return blocks;
}

/**
 * Extracts the `--token: value;` declarations from the nth rule whose selector
 * matches exactly (`occurrence` is 1-based).
 */
export function parseCssCustomProperties(
  css: string,
  selector: string,
  occurrence = 1,
): Record<string, string> {
  const matches = parseCssCustomPropertyBlocks(css).filter(
    (block) => block.selector === selector,
  );
  const block = matches[occurrence - 1];
  if (!block) {
    throw new Error(
      `No rule #${occurrence} found for selector "${selector}" (found ${matches.length})`,
    );
  }
  return block.properties;
}
