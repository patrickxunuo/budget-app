export const REDACTED = "[redacted]";

const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;

// Diagnosis has to survive redaction. `describeCause()` in
// `src/lib/plaid/errors.ts` reports every provider and PostgREST failure
// through exactly these keys, and a redacted error code is an unactionable
// error code. Checked before the sensitive list, so a substring match on
// `code` or `key` can never swallow them.
const PRESERVED_KEYS = new Set([
  "errorcode",
  "errortype",
  "requestid",
  "status",
  "code",
  "hint",
  "source",
  "operation",
]);

const SENSITIVE_KEY_FRAGMENTS = [
  "token",
  "secret",
  "password",
  "passphrase",
  "credential",
  "key",
  "verification",
  "authorization",
  "cookie",
  "session",
  "jwt",
  "bearer",
  "cursor",
  "amount",
  "balance",
  "accountid",
  "accountnumber",
  "itemid",
  "accessid",
  "profileid",
  "membershipid",
  "workspaceid",
  "email",
  "phone",
  "mask",
  "routing",
];

// Matched whole-key only. As fragments these swallow ordinary field names such
// as `author` or `currentPage`; as whole keys they are the Plaid balance and
// authorization payload shapes we actually care about.
const SENSITIVE_KEY_NAMES = new Set(["auth", "available", "current"]);

const SECRET_VALUE_SHAPES = [
  /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
  /^(?:access|link|public)-(?:sandbox|development|production)-/,
  /^sb[ps]?_/,
  // An unbroken 40+ character base64/hex run is a key, a signature, or a
  // provider token — never prose, and never a UUID (36 characters).
  /[A-Za-z0-9+/=_-]{40,}/,
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

function isPreservedKey(key: string): boolean {
  return PRESERVED_KEYS.has(normalizeKey(key));
}

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (PRESERVED_KEYS.has(normalized)) return false;
  if (SENSITIVE_KEY_NAMES.has(normalized)) return true;
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) =>
    normalized.includes(fragment),
  );
}

export function isSensitiveValue(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  return SECRET_VALUE_SHAPES.some((shape) => shape.test(value));
}

// Unanchored counterparts of the shapes above. A secret is at least as likely
// to arrive embedded in a sentence as alone in a field — a driver echoing the
// offending value, a client quoting the URL it called — and replacing only
// whole-string matches let those through untouched.
const EMBEDDED_SECRET_SHAPES = [
  /\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\b(?:access|link|public)-(?:sandbox|development|production)-[A-Za-z0-9_-]+/g,
  /\bsb[ps]?_[A-Za-z0-9_-]{8,}/g,
  /[A-Za-z0-9+/=_-]{40,}/g,
];

function redactString(value: string): string {
  if (isSensitiveValue(value)) return REDACTED;
  return EMBEDDED_SECRET_SHAPES.reduce(
    (scrubbed, shape) => scrubbed.replace(shape, REDACTED),
    value,
  );
}

function redactEntries(
  source: Record<string, unknown>,
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const entries: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (isSensitiveKey(key)) entries[key] = REDACTED;
    // A preserved scalar is reported verbatim: a request id that happens to
    // look high-entropy is still the only handle an operator has on a failure.
    else if (
      isPreservedKey(key) &&
      (entry === null || typeof entry !== "object")
    )
      entries[key] = entry;
    else entries[key] = redactValue(entry, depth + 1, seen);
  }
  return entries;
}

function redactValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return "[function]";
  if (typeof value === "symbol") return "[symbol]";
  if (depth > MAX_DEPTH) return "[truncated]";

  const container = value as object;
  if (seen.has(container)) return "[circular]";
  if (value instanceof Map) return "[Map]";
  if (value instanceof Set) return "[Set]";
  if (value instanceof Date) return value.toISOString();

  seen.add(container);
  let result: unknown;
  if (value instanceof Error) {
    // `stack` is dropped: it carries absolute paths and, for a rejected
    // request, frequently the argument that caused the rejection. `name` and
    // the redacted `message` plus whatever the thrower attached (a Plaid error
    // code, a PostgREST code) are what an operator actually reads.
    const own = Object.fromEntries(
      Object.entries(value as unknown as Record<string, unknown>).filter(
        ([key]) => key !== "stack",
      ),
    );
    result = {
      ...redactEntries(own, depth, seen),
      name: value.name,
      message: redactString(value.message),
    };
  } else if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => redactValue(item, depth + 1, seen));
    result =
      value.length > MAX_ARRAY_ITEMS
        ? [...items, `[+${value.length - MAX_ARRAY_ITEMS} more]`]
        : items;
  } else {
    result = redactEntries(value as Record<string, unknown>, depth, seen);
  }
  seen.delete(container);
  return result;
}

export function redact(value: unknown): unknown {
  return redactValue(value, 0, new WeakSet<object>());
}
