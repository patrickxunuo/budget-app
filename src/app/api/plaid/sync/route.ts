import { z } from "zod";

import { requirePlaidApiActor } from "@/lib/auth/api";
import { PlaidFlowError } from "@/lib/plaid/errors";
import { syncPlaidItem } from "@/lib/plaid/sync-service";
import { plaidApiError, readJson } from "../_shared";

const requestSchema = z.object({ itemId: z.string().uuid() }).strict();

export async function POST(request: Request) {
  try {
    const actor = await requirePlaidApiActor();
    const parsed = requestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new PlaidFlowError(
        400,
        "invalid_request",
        "Send a valid bank connection ID.",
      );
    }
    return Response.json(
      await syncPlaidItem(parsed.data.itemId, "member", actor),
    );
  } catch (error) {
    return plaidApiError(error);
  }
}
