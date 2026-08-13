import { NextResponse } from "next/server";
import { requirePlaidApiActor } from "@/lib/auth/api";
import { disconnectPlaidConnection } from "@/lib/plaid/connection-management";
import { plaidApiError, readJson } from "../../../_shared";
export async function POST(
  request: Request,
  context: RouteContext<"/api/plaid/connections/[itemId]/disconnect">,
) {
  try {
    const { itemId } = await context.params;
    return NextResponse.json(
      await disconnectPlaidConnection(
        await requirePlaidApiActor(),
        itemId,
        await readJson(request),
      ),
    );
  } catch (error) {
    return plaidApiError(error);
  }
}
