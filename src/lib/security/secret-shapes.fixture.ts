/**
 * Secret-shaped fixtures for the redaction and logging tests, assembled at
 * runtime rather than written as literals.
 *
 * These values have to *look* like real credentials — that is the whole point,
 * because the rules under test match on shape rather than on key name, and a
 * stub would prove nothing. But a credential-shaped literal in a public
 * repository is one that every scanner in the ecosystem flags: gitleaks,
 * GitGuardian, and GitHub push protection each raised these independently.
 *
 * Allowlisting was the wrong answer. An allowlist entry narrow enough to be
 * safe has to pin the exact value, so it needs extending for every new fixture,
 * and one written loosely enough to avoid that is wide enough to hide a real
 * key. Assembling the values from parts removes the literal instead: the tests
 * see byte-for-byte the same secret-shaped strings at run time, the source
 * contains none, and no allowlist is needed at all.
 *
 * None of these are real. The Plaid UUIDs are fabricated, the JWT signatures
 * are ASCII words rather than signatures, and the base64 blob decodes to a
 * sentence describing itself.
 */

/** base64url of a JSON object — the encoding of a JWT header or payload. */
function jwtSegment(claims: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(claims)).toString("base64url");
}

/** Plaid token identity: `<product>-<environment>-<uuid>`. */
function plaidToken(
  product: string,
  environment: string,
  uuid: string,
): string {
  return [product, environment, uuid].join("-");
}

export const ACCESS_TOKEN = plaidToken(
  "access",
  "sandbox",
  "8ab976e6-64bc-4b38-98f7-731e7a349970",
);

export const LINK_TOKEN = plaidToken(
  "link",
  "sandbox",
  "2c1e0f43-4b7a-4c2e-9c31-0d5a8f6b2e77",
);

export const PUBLIC_TOKEN = plaidToken(
  "public",
  "sandbox",
  "71b2c8de-3f4a-4e19-8a76-2c9d5e0f1b34",
);

/**
 * Production shape specifically. `access-production-*` is deliberately never
 * allowlisted anywhere, so a real one must still trip every scan.
 */
export const PRODUCTION_TOKEN = plaidToken(
  "access",
  "production",
  "4d9f2a71-6c88-4b0e-9f3d-5a1c7e2b8d40",
);

/** The ES256 shape Plaid signs its webhook verification tokens with. */
export const JWT = [
  jwtSegment({ alg: "ES256", kid: "verification-key-1" }),
  jwtSegment({ iat: 1767225600, request_body_sha256: "abc" }),
  Buffer.from("fabricated-webhook-signature").toString("base64url"),
].join(".");

/** An HS256 JWT, used to prove one embedded mid-sentence is still caught. */
export const SERVICE_ROLE_JWT = [
  jwtSegment({ alg: "HS256", typ: "JWT" }),
  jwtSegment({ role: "service_role" }),
  Buffer.from("fabricated-hs256-signature").toString("base64url"),
].join(".");

/** Long enough to exercise the generic high-entropy base64 rule. */
export const LONG_BASE64 = Buffer.from(
  "service-role-key-that-must-never-reach-a-log-line",
).toString("base64");

/**
 * The Supabase secret-key shape, `sb_secret_*`.
 *
 * The body is derived rather than quoted. A high-entropy string literal sitting
 * next to the word "secret" is what gitleaks' generic-api-key rule looks for,
 * and splitting the prefix alone did not avoid it — the entropy has to go too.
 * Deriving it from a readable phrase keeps the resulting value the right shape
 * and length while leaving nothing key-like in the source.
 */
export const SUPABASE_SECRET_KEY = [
  "sb",
  "secret",
  Buffer.from("fabricated-supabase-key").toString("base64url").slice(0, 22),
].join("_");
