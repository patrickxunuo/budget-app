/**
 * Signature-verified provider callbacks and scheduler-driven cron routes are
 * cross-origin by design: Plaid signs its webhook and the internal routes
 * check a constant-time bearer secret, so neither can rely on an Origin header
 * the caller never sends. The exemption is an explicit allowlist so widening
 * it is a deliberate edit rather than an accident of matcher scope.
 */
export const ORIGIN_EXEMPT_PATHS: readonly string[] = [
  "/api/plaid/webhook",
  "/api/internal/plaid-sync",
  "/api/internal/auth-cleanup",
];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function pathnameOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

export function isTrustedRequestOrigin(
  request: { method: string; headers: Headers; url: string },
  allowedOrigin: string,
): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

  const pathname = pathnameOf(request.url);
  if (
    pathname &&
    ORIGIN_EXEMPT_PATHS.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    )
  )
    return true;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;

  const expected = originOf(allowedOrigin);
  const origin = originOf(request.headers.get("origin"));
  // A present Origin is decided on its own merits even when Sec-Fetch-Site
  // claims same-origin: a mismatch against APP_URL is definitive, and header
  // pairs that disagree are not something a browser produces.
  if (origin) return Boolean(expected) && origin === expected;

  if (fetchSite === "same-origin" || fetchSite === "none") return true;

  const referer = originOf(request.headers.get("referer"));
  if (referer) return Boolean(expected) && referer === expected;

  // No Origin, no Referer, no Sec-Fetch-Site. Every browser sends at least one
  // of them on a state-changing request, so this is a stripped proxy or a
  // hand-rolled forgery. Fail closed.
  return false;
}
