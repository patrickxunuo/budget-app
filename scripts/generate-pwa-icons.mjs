#!/usr/bin/env node
/**
 * Generates the PWA icon set in `public/icons/` from the LedgerMark geometry.
 *
 * Chrome will not offer installation without real PNG icons and iOS ignores an
 * SVG apple-touch-icon, so these have to be rasters. Rather than add an image
 * dependency for six flat-colour marks, this draws them into an RGBA buffer and
 * encodes PNGs with Node's own zlib. Rendering is supersampled 4x and boxed
 * down, which is what gives the corners and the dot clean edges.
 *
 * Run: node scripts/generate-pwa-icons.mjs
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUTPUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "icons",
);

/** Matches --brand / --on-accent in the light palette of globals.css. */
const BRAND = { r: 0x17, g: 0x60, b: 0x44 };
const MARK = { r: 0xff, g: 0xff, b: 0xff };

const SUPERSAMPLE = 4;

function createCanvas(size) {
  return { size, pixels: new Float64Array(size * size * 4) };
}

function blend(canvas, x, y, color, alpha) {
  if (alpha <= 0) return;
  const index = (y * canvas.size + x) * 4;
  const p = canvas.pixels;
  const inverse = 1 - alpha;
  p[index] = p[index] * inverse + color.r * alpha;
  p[index + 1] = p[index + 1] * inverse + color.g * alpha;
  p[index + 2] = p[index + 2] * inverse + color.b * alpha;
  p[index + 3] = p[index + 3] * inverse + 255 * alpha;
}

function fillRoundedRect(canvas, { x, y, width, height, radius, color }) {
  const r = Math.min(radius, width / 2, height / 2);
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(canvas.size, Math.ceil(x + width));
  const bottom = Math.min(canvas.size, Math.ceil(y + height));
  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      // Distance from the inner rectangle that the corner radii orbit.
      const dx = Math.max(x + r - (px + 0.5), px + 0.5 - (x + width - r), 0);
      const dy = Math.max(y + r - (py + 0.5), py + 0.5 - (y + height - r), 0);
      if (dx * dx + dy * dy <= r * r) blend(canvas, px, py, color, 1);
    }
  }
}

function fillCircle(canvas, { cx, cy, radius, color }) {
  const left = Math.max(0, Math.floor(cx - radius));
  const top = Math.max(0, Math.floor(cy - radius));
  const right = Math.min(canvas.size, Math.ceil(cx + radius));
  const bottom = Math.min(canvas.size, Math.ceil(cy + radius));
  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        blend(canvas, px, py, color, 1);
      }
    }
  }
}

/**
 * The ledger mark: a ruled column with two rules and a posting dot, matching
 * `src/components/ledger-mark.tsx`.
 */
function drawMark(canvas, { x, y, size }) {
  const stroke = size * 0.055;
  const inset = size * 0.14;
  const round = stroke / 2;

  // Vertical rule.
  fillRoundedRect(canvas, {
    x: x + size * 0.29 - stroke / 2,
    y: y + inset,
    width: stroke,
    height: size - inset * 2,
    radius: round,
    color: MARK,
  });
  // Two horizontal rules.
  for (const ratio of [0.32, 0.68]) {
    fillRoundedRect(canvas, {
      x: x + inset,
      y: y + size * ratio - stroke / 2,
      width: size - inset * 2,
      height: stroke,
      radius: round,
      color: MARK,
    });
  }
  // Posting dot.
  fillCircle(canvas, {
    cx: x + size * 0.72,
    cy: y + size * 0.5,
    radius: size * 0.085,
    color: MARK,
  });
}

function downsample(canvas, factor) {
  const size = canvas.size / factor;
  const out = Buffer.alloc(size * size * 4);
  const area = factor * factor;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < factor; sy += 1) {
        for (let sx = 0; sx < factor; sx += 1) {
          const index = ((y * factor + sy) * canvas.size + x * factor + sx) * 4;
          r += canvas.pixels[index];
          g += canvas.pixels[index + 1];
          b += canvas.pixels[index + 2];
          a += canvas.pixels[index + 3];
        }
      }
      const target = (y * size + x) * 4;
      out[target] = Math.round(r / area);
      out[target + 1] = Math.round(g / area);
      out[target + 2] = Math.round(b / area);
      out[target + 3] = Math.round(a / area);
    }
  }
  return { size, rgba: out };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng({ size, rgba }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * @param {object} options
 * @param {number} options.size            final pixel size
 * @param {"rounded"|"full"} options.shape rounded for `purpose: any`,
 *                                         full-bleed for maskable and Apple
 * @param {number} options.markScale       mark size as a fraction of the canvas
 */
function renderIcon({ size, shape, markScale }) {
  const scaled = size * SUPERSAMPLE;
  const canvas = createCanvas(scaled);

  fillRoundedRect(canvas, {
    x: 0,
    y: 0,
    width: scaled,
    height: scaled,
    radius: shape === "rounded" ? scaled * 0.22 : 0,
    color: BRAND,
  });

  const markSize = scaled * markScale;
  drawMark(canvas, {
    x: (scaled - markSize) / 2,
    y: (scaled - markSize) / 2,
    size: markSize,
  });

  return encodePng(downsample(canvas, SUPERSAMPLE));
}

const ICONS = [
  // purpose: any — rounded so it reads as an app tile on its own.
  { file: "icon-192.png", size: 192, shape: "rounded", markScale: 0.74 },
  { file: "icon-512.png", size: 512, shape: "rounded", markScale: 0.74 },
  // purpose: maskable — opaque to the edge, mark inside the 80% safe zone.
  { file: "maskable-192.png", size: 192, shape: "full", markScale: 0.56 },
  { file: "maskable-512.png", size: 512, shape: "full", markScale: 0.56 },
  // iOS applies its own mask and does not composite transparency.
  {
    file: "apple-touch-icon-180.png",
    size: 180,
    shape: "full",
    markScale: 0.7,
  },
];

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const icon of ICONS) {
  const png = renderIcon(icon);
  writeFileSync(join(OUTPUT_DIR, icon.file), png);
  console.log(`${icon.file} — ${icon.size}x${icon.size}, ${png.length} bytes`);
}
