export type SecurityHeader = { key: string; value: string };

type SecurityHeaderOptions = { isProduction?: boolean };

const PLAID_LINK_CDN = "https://cdn.plaid.com";
const PLAID_API = "https://*.plaid.com";

function resolveIsProduction(options: SecurityHeaderOptions): boolean {
  return options.isProduction ?? process.env.NODE_ENV === "production";
}

// A malformed or absent Supabase URL must degrade to `'self'` rather than
// throw: `next.config.ts` evaluates this at build time, and a missing env var
// should surface from the Zod env contract, not from a config crash.
function supabaseEndpoints(
  supabaseUrl: string,
): { origin: string; socket: string } | null {
  try {
    const url = new URL(supabaseUrl);
    if (!url.host) return null;
    return { origin: url.origin, socket: `wss://${url.host}` };
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(
  supabaseUrl: string,
  options: SecurityHeaderOptions = {},
): string {
  const isProduction = resolveIsProduction(options);
  const supabase = supabaseEndpoints(supabaseUrl);

  const connectSrc = ["'self'"];
  if (supabase) connectSrc.push(supabase.origin);
  connectSrc.push(PLAID_API);
  if (supabase) connectSrc.push(supabase.socket);

  // `'unsafe-inline'` is required, not merely convenient: the theme is applied
  // by an inline `<head>` script before first paint (a hydration-safe
  // requirement, see memory-bank/systemPatterns.md) and Next injects its own
  // inline bootstrap scripts. Moving to a nonce-based policy means routing
  // both through a per-request nonce in the proxy, which is the follow-up to
  // this ticket. `'unsafe-eval'` is dev-only, for React Refresh.
  const scriptSrc = ["'self'", "'unsafe-inline'", PLAID_LINK_CDN];
  if (!isProduction) scriptSrc.push("'unsafe-eval'");

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(" ")}`,
    `frame-src ${PLAID_LINK_CDN} ${PLAID_API}`,
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self'",
    "manifest-src 'self'",
  ];
  if (isProduction) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export function securityHeaders(
  options: SecurityHeaderOptions = {},
): SecurityHeader[] {
  const isProduction = resolveIsProduction(options);
  const headers: SecurityHeader[] = [
    {
      key: "Content-Security-Policy",
      value: contentSecurityPolicy(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", {
        isProduction,
      }),
    },
  ];
  if (isProduction)
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  headers.push(
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value:
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  );
  return headers;
}
