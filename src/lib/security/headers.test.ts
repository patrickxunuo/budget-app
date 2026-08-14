// @vitest-environment node
// The header table is consumed by next.config.ts: no DOM is needed, and
// skipping jsdom keeps the full-suite memory footprint down.
import { describe, expect, it, vi } from "vitest";

// next.config.ts evaluates this table before any request, so the module must
// resolve with only the public Supabase origin present.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://abcdefghijkl.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test";
});
vi.mock("server-only", () => ({}));

import {
  contentSecurityPolicy,
  securityHeaders,
  type SecurityHeader,
} from "@/lib/security/headers";

const SUPABASE_URL = "https://abcdefghijkl.supabase.co";

const REQUIRED_HEADERS = [
  "Content-Security-Policy",
  "X-Content-Type-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "X-Frame-Options",
  "Cross-Origin-Opener-Policy",
];

function headerValue(
  headers: readonly SecurityHeader[],
  key: string,
): string | undefined {
  return headers.find(
    (header) => header.key.toLowerCase() === key.toLowerCase(),
  )?.value;
}

/** The source list for one CSP directive, or undefined when it is absent. */
function directive(policy: string, name: string): string[] | undefined {
  const part = policy
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean)
    .find((value) => value === name || value.startsWith(`${name} `));
  return part === undefined ? undefined : part.split(/\s+/).slice(1);
}

function maxAge(value: string): number {
  return Number(/max-age=(\d+)/i.exec(value)?.[1] ?? Number.NaN);
}

describe("GH-14 security response headers (F2)", () => {
  it.each(REQUIRED_HEADERS)("SEC-301 always sends %s", (key) => {
    for (const headers of [
      securityHeaders(),
      securityHeaders({ isProduction: true }),
      securityHeaders({ isProduction: false }),
    ]) {
      expect(headerValue(headers, key)).toBeTruthy();
    }
  });

  it("SEC-302 pins the fixed-value headers to their hardened settings", () => {
    const headers = securityHeaders({ isProduction: true });

    expect(headerValue(headers, "X-Content-Type-Options")).toBe("nosniff");
    expect(headerValue(headers, "X-Frame-Options")).toBe("DENY");
    expect(headerValue(headers, "Cross-Origin-Opener-Policy")).toBe(
      "same-origin",
    );
    expect(headerValue(headers, "Referrer-Policy")).toMatch(
      /^(?:no-referrer|same-origin|strict-origin|strict-origin-when-cross-origin)$/,
    );
    // A Permissions-Policy that grants nothing is still a policy; an empty
    // string is not.
    expect(headerValue(headers, "Permissions-Policy")?.length).toBeGreaterThan(
      0,
    );
  });

  it("SEC-303 sends a year-long HSTS in production and does not pin localhost", () => {
    const production = headerValue(
      securityHeaders({ isProduction: true }),
      "Strict-Transport-Security",
    );
    expect(production).toBeDefined();
    expect(maxAge(production!)).toBeGreaterThanOrEqual(31_536_000);

    // Development runs over plain HTTP. Advertising a year of HSTS from a dev
    // build would strand the origin in a browser's preload state.
    const development = headerValue(
      securityHeaders({ isProduction: false }),
      "Strict-Transport-Security",
    );
    expect(
      development === undefined || maxAge(development) === 0,
      `non-production HSTS must not pin the origin, got ${String(development)}`,
    ).toBe(true);
  });

  it("SEC-304 returns no duplicate header keys", () => {
    for (const headers of [
      securityHeaders({ isProduction: true }),
      securityHeaders({ isProduction: false }),
    ]) {
      const keys = headers.map((header) => header.key.toLowerCase());
      expect(keys).toEqual([...new Set(keys)]);
    }
  });

  it("SEC-305 carries frame-ancestors 'none' in the applied policy", () => {
    const policy = headerValue(
      securityHeaders({ isProduction: true }),
      "Content-Security-Policy",
    );
    expect(policy).toBeDefined();
    expect(directive(policy!, "frame-ancestors")).toEqual(["'none'"]);
  });
});

describe("GH-14 Content-Security-Policy (F2)", () => {
  const policy = contentSecurityPolicy(SUPABASE_URL);

  it.each([
    ["default-src", "'self'"],
    ["frame-ancestors", "'none'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
  ])("SEC-306 declares %s %s", (name, expected) => {
    expect(directive(policy, name)).toContain(expected);
  });

  it.each(["default-src", "connect-src"])(
    "SEC-307 admits no bare wildcard in %s",
    (name) => {
      const sources = directive(policy, name);
      expect(sources).toBeDefined();
      expect(sources).not.toContain("*");
      for (const source of sources!) {
        expect(source).not.toBe("*");
        expect(source).not.toBe("http:");
        expect(source).not.toBe("https:");
      }
    },
  );

  it("SEC-308 admits the configured Supabase origin in connect-src", () => {
    const sources = directive(policy, "connect-src") ?? [];
    const host = new URL(SUPABASE_URL).host;

    expect(sources).toContain(new URL(SUPABASE_URL).origin);
    expect(sources.some((source) => source.includes(host))).toBe(true);
  });

  it("SEC-309 derives the origin rather than echoing the configured path", () => {
    const sources =
      directive(
        contentSecurityPolicy(`${SUPABASE_URL}/rest/v1?apikey=leaked`),
        "connect-src",
      ) ?? [];

    expect(sources).toContain(new URL(SUPABASE_URL).origin);
    expect(sources.join(" ")).not.toContain("apikey");
    expect(sources.join(" ")).not.toContain("/rest/v1");
  });

  it("SEC-310 admits Plaid in connect-src", () => {
    const sources = directive(policy, "connect-src") ?? [];
    expect(sources.some((source) => source.includes("plaid.com"))).toBe(true);
  });

  it.each([
    ["an empty string", ""],
    ["whitespace", "   "],
    ["a non-URL", "not a url"],
    ["a bare host", "abcdefghijkl.supabase.co"],
  ])("SEC-311 survives %s as the Supabase URL", (_case, value) => {
    let fallback = "";
    expect(() => {
      fallback = contentSecurityPolicy(value);
    }).not.toThrow();

    expect(directive(fallback, "default-src")).toContain("'self'");
    expect(directive(fallback, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(fallback, "connect-src")).not.toContain("*");
  });
});
