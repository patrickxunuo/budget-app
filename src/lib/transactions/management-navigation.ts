import type { Scope } from "@/lib/manual-entries/types";

const TRANSACTIONS_PATH = "/transactions";

function fallbackFor(scope: Scope) {
  return `${TRANSACTIONS_PATH}?scope=${scope}`;
}

/**
 * Resolve an untrusted return target without ever allowing navigation outside
 * the read-only Transactions overview.
 */
export function resolveTransactionReturnTo(
  raw: string | string[] | undefined,
  scope: Scope,
): string {
  const fallback = fallbackFor(scope);
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) {
    return fallback;
  }

  try {
    const target = new URL(raw, "https://piggy.invalid");
    if (
      target.origin !== "https://piggy.invalid" ||
      target.pathname !== TRANSACTIONS_PATH ||
      target.username !== "" ||
      target.password !== ""
    ) {
      return fallback;
    }

    return `${TRANSACTIONS_PATH}${target.search}`;
  } catch {
    return fallback;
  }
}
