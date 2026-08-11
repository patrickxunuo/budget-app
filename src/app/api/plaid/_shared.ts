import { NextResponse } from "next/server";

import { ApiAuthError } from "@/lib/auth/api";
import { PlaidFlowError } from "@/lib/plaid/errors";

export function plaidApiError(error: unknown) {
  if (error instanceof ApiAuthError || error instanceof PlaidFlowError) {
    return NextResponse.json(
      {
        code: error.code,
        message: error.message,
        ...(error instanceof PlaidFlowError && error.fieldErrors
          ? { fieldErrors: error.fieldErrors }
          : {}),
      },
      { status: error.status },
    );
  }
  return NextResponse.json(
    {
      code: "unexpected_error",
      message: "The bank connection could not be completed. Please try again.",
    },
    { status: 502 },
  );
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new PlaidFlowError(400, "invalid_json", "Send a valid JSON request.");
  }
}
