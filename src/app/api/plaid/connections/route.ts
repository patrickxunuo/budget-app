import { NextResponse } from "next/server";
import { requirePlaidApiActor } from "@/lib/auth/api";
import { getPlaidConnections } from "@/lib/plaid/connection-management";
import { plaidApiError } from "../_shared";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json({
      connections: await getPlaidConnections(await requirePlaidApiActor()),
    });
  } catch (error) {
    return plaidApiError(error);
  }
}
