import { NextResponse } from "next/server";

import { requirePlaidApiActor } from "@/lib/auth/api";
import { createLinkTokenForMember } from "@/lib/plaid/service";
import { plaidApiError } from "../_shared";

export async function POST() {
  try {
    const actor = await requirePlaidApiActor();
    return NextResponse.json(await createLinkTokenForMember(actor));
  } catch (error) {
    return plaidApiError(error);
  }
}
