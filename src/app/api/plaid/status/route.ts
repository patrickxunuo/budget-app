import { requirePlaidApiActor } from "@/lib/auth/api";
import { getPlaidSyncStatuses } from "@/lib/plaid/sync-service";
import { plaidApiError } from "../_shared";

export async function GET() {
  try {
    const actor = await requirePlaidApiActor();
    return Response.json({ items: await getPlaidSyncStatuses(actor) });
  } catch (error) {
    return plaidApiError(error);
  }
}
