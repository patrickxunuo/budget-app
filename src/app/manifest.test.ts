// @vitest-environment node
// This suite is pure Node: no DOM is needed, and skipping jsdom keeps the
// full-suite memory footprint down.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { THEME_COLORS } from "@/lib/theme/theme";

import manifest from "./manifest";

const PUBLIC_DIR = join(process.cwd(), "public");
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const value = manifest();
const icons = value.icons ?? [];

/** Reads the IHDR dimensions straight out of the PNG byte stream. */
function readPng(publicPath: string) {
  const absolute = join(PUBLIC_DIR, publicPath.replace(/^\//, ""));
  expect(existsSync(absolute), `${publicPath} is missing from public/`).toBe(
    true,
  );
  const bytes = readFileSync(absolute);
  return {
    absolute,
    signature: bytes.subarray(0, 8),
    chunkType: bytes.subarray(12, 16).toString("ascii"),
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    byteLength: bytes.byteLength,
  };
}

/**
 * Decodes the RGBA pixels of an icon produced by `scripts/generate-pwa-icons.mjs`.
 * That encoder writes 8-bit RGBA with filter 0 on every scanline, which the
 * assertion below pins down, so unfiltering reduces to dropping one byte per
 * row. Anything else means the encoder changed and this decoder is no longer
 * valid — which is exactly what we want to hear about.
 */
function decodePng(publicPath: string) {
  const absolute = join(PUBLIC_DIR, publicPath.replace(/^\//, ""));
  const bytes = readFileSync(absolute);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  expect(bytes[24], `${publicPath} is not 8-bit`).toBe(8);
  expect(bytes[25], `${publicPath} is not RGBA`).toBe(6);

  const parts: Buffer[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") {
      parts.push(bytes.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(parts));

  const stride = width * 4;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    expect(raw[rowStart], `${publicPath} row ${y} is not filter 0`).toBe(0);
    raw.copy(pixels, y * stride, rowStart + 1, rowStart + 1 + stride);
  }

  const alphaAt = (x: number, y: number) =>
    pixels[(y * width + x) * 4 + 3] ?? 0;
  return { width, height, alphaAt, pixels };
}

describe("GH-13 installable manifest (AC1)", () => {
  it("MF-001 declares the documented identity and launch behaviour", () => {
    expect(value.name).toBe("Budget App");
    expect(value.short_name).toBeTypeOf("string");
    expect((value.short_name ?? "").length).toBeGreaterThan(0);
    expect((value.short_name ?? "").length).toBeLessThanOrEqual(12);
    expect(value.display).toBe("standalone");
    expect(value.start_url).toBe("/dashboard");
    expect(value.scope).toBe("/");
    expect(value.id).toBeTypeOf("string");
    expect(value.id).toBe("/");
    expect(value.lang).toBe("en-CA");
    expect(value.dir).toBe("ltr");
    expect(value.orientation).toBe("portrait-primary");
  });

  it("MF-002 paints the install splash from the light palette", () => {
    expect(value.background_color).toBe(THEME_COLORS.light);
    expect(value.theme_color).toBe(THEME_COLORS.light);
  });

  it("MF-003 declares 192 and 512 PNGs for both any and maskable purposes", () => {
    const declared = icons.map((icon) => ({
      sizes: icon.sizes,
      type: icon.type,
      purpose: icon.purpose,
      src: icon.src,
    }));

    for (const purpose of ["any", "maskable"]) {
      for (const sizes of ["192x192", "512x512"]) {
        const match = declared.filter(
          (icon) => icon.purpose === purpose && icon.sizes === sizes,
        );
        expect(
          match,
          `expected exactly one ${sizes} icon with purpose "${purpose}"`,
        ).toHaveLength(1);
        expect(match[0]?.type).toBe("image/png");
        expect(match[0]?.src).toMatch(/^\/icons\/.+\.png$/);
      }
    }

    expect(declared).toHaveLength(4);
    expect(new Set(declared.map((icon) => icon.src)).size).toBe(4);
  });
});

describe("GH-13 icon assets are real, correctly sized PNGs (AC1)", () => {
  it.each(icons.map((icon) => [icon.src, icon.sizes] as [string, string]))(
    "MF-004 %s is a %s PNG on disk",
    (src, sizes) => {
      const png = readPng(src);
      const [declaredWidth, declaredHeight] = sizes
        .split("x")
        .map((part) => Number.parseInt(part, 10));

      expect(png.signature.equals(PNG_SIGNATURE)).toBe(true);
      expect(png.chunkType).toBe("IHDR");
      expect(png.width).toBe(declaredWidth);
      expect(png.height).toBe(declaredHeight);
      expect(png.byteLength).toBeGreaterThan(64);
    },
  );

  it("MF-005 ships a 180px apple-touch-icon for iOS home screens", () => {
    const png = readPng("/icons/apple-touch-icon-180.png");

    expect(png.signature.equals(PNG_SIGNATURE)).toBe(true);
    expect(png.chunkType).toBe("IHDR");
    expect(png.width).toBe(180);
    expect(png.height).toBe(180);
  });
});

describe("GH-13 maskable artwork survives Android's mask (AC1)", () => {
  const maskable = icons
    .filter((icon) => icon.purpose === "maskable")
    .map((icon) => icon.src);

  it("MF-006 declares maskable icons at all", () => {
    expect(maskable.length).toBeGreaterThan(0);
  });

  // iOS composites the touch icon onto white, so transparency there shows as a
  // white bite out of the corner; Android crops maskables to an arbitrary
  // shape, so any transparent pixel can end up on the visible edge.
  it.each([...maskable, "/icons/apple-touch-icon-180.png"])(
    "MF-007 %s is opaque edge to edge",
    (src) => {
      const { width, height, alphaAt } = decodePng(src);

      for (const [x, y] of [
        [0, 0],
        [width - 1, 0],
        [0, height - 1],
        [width - 1, height - 1],
        [Math.floor(width / 2), 0],
        [0, Math.floor(height / 2)],
      ]) {
        expect(alphaAt(x!, y!), `${src} is transparent at ${x},${y}`).toBe(255);
      }
    },
  );

  it.each(maskable)(
    "MF-008 %s keeps its mark inside the 80%% safe zone",
    (src) => {
      const { width, height, pixels } = decodePng(src);
      // The mark is the only near-white ink on the brand field.
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = (y * width + x) * 4;
          const isInk =
            (pixels[index] ?? 0) > 200 &&
            (pixels[index + 1] ?? 0) > 200 &&
            (pixels[index + 2] ?? 0) > 200;
          if (!isInk) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }

      expect(maxX, `${src} has no visible mark`).toBeGreaterThan(-1);
      // The safe zone is the central 80%, i.e. a 10% margin on every side.
      const marginX = width * 0.1;
      const marginY = height * 0.1;
      expect(minX).toBeGreaterThanOrEqual(marginX);
      expect(minY).toBeGreaterThanOrEqual(marginY);
      expect(maxX).toBeLessThanOrEqual(width - marginX);
      expect(maxY).toBeLessThanOrEqual(height - marginY);
    },
  );
});
