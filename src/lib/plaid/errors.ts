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

// Server-side diagnosis only. The caller still receives the sanitized message,
// but an operator can no longer be left with a 502 and no cause. Row payloads
// and PostgreSQL detail strings are excluded because they can carry encrypted
// token material.
function describeCause(cause: unknown): Record<string, unknown> {
  if (!cause || typeof cause !== "object") {
    return { causeType: typeof cause, cause: String(cause) };
  }
  const candidate = cause as {
    code?: unknown;
    hint?: unknown;
    message?: unknown;
    response?: { status?: unknown; data?: Record<string, unknown> };
  };
  const plaidError = candidate.response?.data;
  if (plaidError?.error_code) {
    return {
      source: "plaid",
      status: candidate.response?.status,
      errorCode: plaidError.error_code,
      errorType: plaidError.error_type,
      requestId: plaidError.request_id,
    };
  }
  return {
    source: "database",
    code: candidate.code,
    hint: candidate.hint,
    message: candidate.message,
  };
}

export function sanitizedPlaidFailure(
  operation: "link" | "exchange" | "activate",
  cause?: unknown,
): PlaidFlowError {
  const messages = {
    link: "Plaid could not start a secure connection. Please try again.",
    exchange:
      "Plaid could not verify that connection. Please reconnect your bank.",
    activate:
      "The initial transaction import could not finish. Please try again.",
  } as const;
  if (cause !== undefined) {
    console.error("Plaid flow failed", {
      operation,
      ...describeCause(cause),
    });
  }
  return new PlaidFlowError(
    502,
    `plaid_${operation}_failed`,
    messages[operation],
  );
}
