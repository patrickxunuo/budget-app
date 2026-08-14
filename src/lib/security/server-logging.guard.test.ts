// @vitest-environment node
// A static source guard: it reads the repository from disk, so no DOM is
// needed and skipping jsdom keeps the full-suite memory footprint down.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** Trees whose modules run on the server and must not write to the console. */
const SCANNED_DIRECTORIES = [join("src", "lib"), join("src", "app", "api")];

const SCANNED_FILES = [join("src", "proxy.ts")];

/**
 * The single sanctioned writer. `logServerEvent` is the one place a raw
 * `console.*` call is allowed, because it is the function that redacts.
 */
const EXEMPT_FILES = new Set([join("src", "lib", "security", "log.ts")]);

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function isSourceFile(path: string): boolean {
  if (/\.test\.tsx?$/.test(path)) return false;
  if (/\.d\.ts$/.test(path)) return false;
  return SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

function walk(directory: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const absolute = join(directory, entry);
    return statSync(absolute).isDirectory()
      ? walk(absolute)
      : isSourceFile(absolute)
        ? [absolute]
        : [];
  });
}

/**
 * Blanks comments and string/template literals while preserving every byte
 * offset, so a `console.` inside a comment or a documentation string is not
 * reported and the surviving matches still resolve to their real line.
 * Deliberately conservative: masking too much can only hide a call, never
 * invent one.
 */
export function maskCommentsAndLiterals(source: string): string {
  const characters = [...source];
  const blank = (from: number, to: number) => {
    for (let index = from; index < Math.min(to, characters.length); index++) {
      if (characters[index] !== "\n") characters[index] = " ";
    }
  };

  let index = 0;
  while (index < source.length) {
    const pair = source.slice(index, index + 2);
    if (pair === "//") {
      const end = source.indexOf("\n", index);
      const stop = end === -1 ? source.length : end;
      blank(index, stop);
      index = stop;
      continue;
    }
    if (pair === "/*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(index, stop);
      index = stop;
      continue;
    }
    const quote = source[index];
    if (quote === '"' || quote === "'" || quote === "`") {
      let cursor = index + 1;
      while (cursor < source.length) {
        if (source[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (source[cursor] === quote) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      blank(index, cursor);
      index = cursor;
      continue;
    }
    index += 1;
  }

  return characters.join("");
}

function consoleCallSites(absolutePath: string): string[] {
  const source = readFileSync(absolutePath, "utf8");
  const masked = maskCommentsAndLiterals(source);
  const pattern = /\bconsole\s*\./g;
  const sites: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(masked)) !== null) {
    const line = masked.slice(0, match.index).split("\n").length;
    const text = source.split("\n")[line - 1]?.trim() ?? "";
    sites.push(
      `${relative(ROOT, absolutePath).split(sep).join("/")}:${line} — ${text}`,
    );
  }
  return sites;
}

const scanned = [
  ...SCANNED_DIRECTORIES.flatMap((directory) => walk(join(ROOT, directory))),
  ...SCANNED_FILES.map((file) => join(ROOT, file)),
].filter((absolute) => !EXEMPT_FILES.has(relative(ROOT, absolute)));

describe("GH-14 sanctioned server logging guard (F4)", () => {
  it("SEC-601 actually finds the server modules it claims to guard", () => {
    // A guard that silently scans nothing is worse than no guard.
    expect(scanned.length).toBeGreaterThan(20);
    for (const expected of [
      join("src", "proxy.ts"),
      join("src", "lib", "plaid", "sync-service.ts"),
      join("src", "lib", "auth", "actions.ts"),
    ]) {
      expect(scanned.map((path) => relative(ROOT, path))).toContain(expected);
    }
    expect(scanned.some((path) => /\.test\.tsx?$/.test(path))).toBe(false);
  });

  it("SEC-602 blanks comments and literals without shifting line numbers", () => {
    const source = [
      'const banner = "console.log is fine inside a string";',
      "// console.warn in a comment is fine",
      "/* console.error in a block comment is fine */",
      "console.info(realCall);",
    ].join("\n");

    const masked = maskCommentsAndLiterals(source);

    expect(masked.split("\n")).toHaveLength(4);
    expect(masked.split("\n")[0]).not.toContain("console");
    expect(masked.split("\n")[1]).not.toContain("console");
    expect(masked.split("\n")[2]).not.toContain("console");
    expect(masked.split("\n")[3]).toContain("console.info");
  });

  it("SEC-603 routes every server console call through logServerEvent", () => {
    const offenders = scanned.flatMap(consoleCallSites);

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `Raw console calls must go through logServerEvent() from ` +
            `@/lib/security/log:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("SEC-604 exempts only the redacting logger itself", () => {
    expect([...EXEMPT_FILES]).toEqual([
      join("src", "lib", "security", "log.ts"),
    ]);
  });
});
