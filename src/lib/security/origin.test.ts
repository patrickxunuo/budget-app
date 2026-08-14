// @vitest-environment node
// The origin gate runs in the proxy: no DOM is needed, and skipping jsdom
// keeps the full-suite memory footprint down.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  isTrustedRequestOrigin,
  ORIGIN_EXEMPT_PATHS,
} from "@/lib/security/origin";

const APP_ORIGIN = "https://budget.example.test";
const EVIL_ORIGIN = "https://budget.example.test.attacker.test";
const WEBHOOK_PATH = "/api/plaid/webhook";

const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];
const STATE_CHANGING_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

function request(
  method: string,
  headers: Record<string, string> = {},
  path = "/api/transactions",
) {
  return {
    method,
    headers: new Headers(headers),
    url: `${APP_ORIGIN}${path}`,
  };
}

describe("GH-14 origin gate admits safe methods (F2)", () => {
  it.each(SAFE_METHODS)("SEC-401 trusts %s regardless of Origin", (method) => {
    expect(isTrustedRequestOrigin(request(method), APP_ORIGIN)).toBe(true);
    expect(
      isTrustedRequestOrigin(
        request(method, { origin: EVIL_ORIGIN }),
        APP_ORIGIN,
      ),
    ).toBe(true);
    expect(
      isTrustedRequestOrigin(
        request(method, { "sec-fetch-site": "cross-site" }),
        APP_ORIGIN,
      ),
    ).toBe(true);
  });
});

describe("GH-14 origin gate on state-changing requests (F2)", () => {
  it.each(STATE_CHANGING_METHODS)(
    "SEC-402 trusts %s from the configured origin",
    (method) => {
      expect(
        isTrustedRequestOrigin(
          request(method, { origin: APP_ORIGIN }),
          APP_ORIGIN,
        ),
      ).toBe(true);
    },
  );

  it.each(STATE_CHANGING_METHODS)(
    "SEC-403 rejects %s from a foreign origin",
    (method) => {
      expect(
        isTrustedRequestOrigin(
          request(method, { origin: EVIL_ORIGIN }),
          APP_ORIGIN,
        ),
      ).toBe(false);
    },
  );

  it("SEC-404 rejects an opaque `Origin: null`", () => {
    expect(
      isTrustedRequestOrigin(request("POST", { origin: "null" }), APP_ORIGIN),
    ).toBe(false);
  });

  it("SEC-405 rejects a scheme, host, or port that differs from the allowed origin", () => {
    for (const origin of [
      "http://budget.example.test",
      "https://budget.example.test:8443",
      "https://other.example.test",
      "https://budget.example.test.attacker.test",
      "https://attacker.test/?x=https://budget.example.test",
    ]) {
      expect(
        isTrustedRequestOrigin(request("POST", { origin }), APP_ORIGIN),
        `${origin} must not be treated as ${APP_ORIGIN}`,
      ).toBe(false);
    }
  });

  it("SEC-406 trusts `Sec-Fetch-Site: same-origin`", () => {
    expect(
      isTrustedRequestOrigin(
        request("POST", { "sec-fetch-site": "same-origin" }),
        APP_ORIGIN,
      ),
    ).toBe(true);
  });

  it("SEC-407 lets a cross-site Sec-Fetch-Site deny win over a matching Origin", () => {
    expect(
      isTrustedRequestOrigin(
        request("POST", {
          origin: APP_ORIGIN,
          "sec-fetch-site": "cross-site",
        }),
        APP_ORIGIN,
      ),
    ).toBe(false);
    expect(
      isTrustedRequestOrigin(
        request("POST", {
          origin: APP_ORIGIN,
          referer: `${APP_ORIGIN}/dashboard`,
          "sec-fetch-site": "cross-site",
        }),
        APP_ORIGIN,
      ),
    ).toBe(false);
  });

  it("SEC-408 falls back to Referer when Origin is absent", () => {
    expect(
      isTrustedRequestOrigin(
        request("POST", { referer: `${APP_ORIGIN}/settings/members` }),
        APP_ORIGIN,
      ),
    ).toBe(true);
    expect(
      isTrustedRequestOrigin(
        request("POST", { referer: `${EVIL_ORIGIN}/settings/members` }),
        APP_ORIGIN,
      ),
    ).toBe(false);
  });

  it.each(STATE_CHANGING_METHODS)(
    "SEC-409 fails closed on %s with no Origin, Referer, or Sec-Fetch-Site",
    (method) => {
      expect(isTrustedRequestOrigin(request(method), APP_ORIGIN)).toBe(false);
    },
  );
});

describe("GH-14 signature-verified provider callbacks (F2)", () => {
  it("SEC-410 lists the Plaid webhook as an explicit exemption", () => {
    expect(ORIGIN_EXEMPT_PATHS).toContain(WEBHOOK_PATH);
  });

  it("SEC-411 keeps the exemption allowlist narrow", () => {
    // An accidental "/" or "/api" here would silently disable the whole gate.
    for (const path of ORIGIN_EXEMPT_PATHS) {
      expect(path.startsWith("/")).toBe(true);
      expect(path.length).toBeGreaterThan("/api".length);
      expect(path).not.toContain("*");
    }
  });

  it.each(STATE_CHANGING_METHODS)(
    "SEC-412 admits a cross-site %s to the exempt webhook path",
    (method) => {
      expect(
        isTrustedRequestOrigin(
          request(
            method,
            { origin: EVIL_ORIGIN, "sec-fetch-site": "cross-site" },
            WEBHOOK_PATH,
          ),
          APP_ORIGIN,
        ),
      ).toBe(true);
      expect(
        isTrustedRequestOrigin(request(method, {}, WEBHOOK_PATH), APP_ORIGIN),
      ).toBe(true);
    },
  );

  it("SEC-413 does not extend the exemption to a lookalike path", () => {
    for (const path of [
      "/api/plaid/webhook-forged",
      "/api/plaid",
      "/api/plaid/sync",
    ]) {
      expect(
        isTrustedRequestOrigin(
          request("POST", { origin: EVIL_ORIGIN }, path),
          APP_ORIGIN,
        ),
        `${path} must not inherit the webhook exemption`,
      ).toBe(false);
    }
  });
});

describe("GH-14 origin gate tolerates malformed input (F2)", () => {
  it.each([
    ["a non-URL Origin", { origin: "not a url" }],
    ["an empty Origin", { origin: "" }],
    ["a non-URL Referer", { referer: "not a url" }],
    ["an unknown Sec-Fetch-Site", { "sec-fetch-site": "banana" }],
  ])("SEC-414 does not throw on %s", (_case, headers) => {
    let verdict: boolean | undefined;
    expect(() => {
      verdict = isTrustedRequestOrigin(request("POST", headers), APP_ORIGIN);
    }).not.toThrow();
    expect(verdict).toBe(false);
  });

  it.each([
    ["an empty allowed origin", ""],
    ["a malformed allowed origin", "not a url"],
  ])("SEC-415 fails closed on %s", (_case, allowedOrigin) => {
    let verdict: boolean | undefined;
    expect(() => {
      verdict = isTrustedRequestOrigin(
        request("POST", { origin: APP_ORIGIN }),
        allowedOrigin,
      );
    }).not.toThrow();
    expect(verdict).toBe(false);
  });
});
