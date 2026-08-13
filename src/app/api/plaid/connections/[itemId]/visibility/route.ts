import { NextResponse } from "next/server";
import { requirePlaidApiActor } from "@/lib/auth/api";
import { changePlaidAccountVisibility } from "@/lib/plaid/connection-management";
import { plaidApiError, readJson } from "../../../_shared";
export async function PATCH(
  request: Request,
  context: RouteContext<"/api/plaid/connections/[itemId]/visibility">,
) {
  try {
    const { itemId } = await context.params;
    return NextResponse.json(
      await changePlaidAccountVisibility(
        await requirePlaidApiActor(),
        itemId,
        await readJson(request),
      ),
    );
  } catch (error) {
    return plaidApiError(error);
  }
}
