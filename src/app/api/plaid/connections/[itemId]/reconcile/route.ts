import { NextResponse } from "next/server";
import { requirePlaidApiActor } from "@/lib/auth/api";
import { reconcilePlaidConnection } from "@/lib/plaid/connection-management";
import { plaidApiError, readJson } from "../../../_shared";
export async function POST(
  request: Request,
  context: RouteContext<"/api/plaid/connections/[itemId]/reconcile">,
) {
  try {
    const { itemId } = await context.params;
    return NextResponse.json(
      await reconcilePlaidConnection(
        await requirePlaidApiActor(),
        itemId,
        await readJson(request),
      ),
    );
  } catch (error) {
    return plaidApiError(error);
  }
}
