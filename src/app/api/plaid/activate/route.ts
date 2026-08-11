import { NextResponse } from "next/server";

import { requirePlaidApiActor } from "@/lib/auth/api";
import { activatePlaidReview } from "@/lib/plaid/service";
import { plaidApiError, readJson } from "../_shared";

export async function POST(request: Request) {
  try {
    const actor = await requirePlaidApiActor();
    const input = await readJson(request);
    return NextResponse.json(await activatePlaidReview(actor, input));
  } catch (error) {
    return plaidApiError(error);
  }
}
