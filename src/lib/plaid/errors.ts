import "server-only";

export class PlaidFlowError extends Error {
  constructor(
    public readonly status: 400 | 403 | 409 | 410 | 422 | 502,
    public readonly code: string,
    message: string,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

export function isPlaidProductNotReady(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    response?: { data?: { error_code?: unknown } };
    code?: unknown;
  };
  return (
    candidate.response?.data?.error_code === "PRODUCT_NOT_READY" ||
    candidate.code === "PRODUCT_NOT_READY"
  );
}

export function sanitizedPlaidFailure(
  operation: "link" | "exchange" | "activate",
): PlaidFlowError {
  const messages = {
    link: "Plaid could not start a secure connection. Please try again.",
    exchange:
      "Plaid could not verify that connection. Please reconnect your bank.",
    activate:
      "The initial transaction import could not finish. Please try again.",
  } as const;
  return new PlaidFlowError(
    502,
    `plaid_${operation}_failed`,
    messages[operation],
  );
}
