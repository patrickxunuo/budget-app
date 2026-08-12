import { timingSafeEqual } from "node:crypto";

import { getServerEnv } from "@/lib/env/server";
import { syncEligiblePlaidItems } from "@/lib/plaid/sync-service";

function isAuthorized(request: Request) {
  const expected = Buffer.from(`Bearer ${getServerEnv().CRON_SECRET}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ code: "unauthorized" }, { status: 401 });
  }
  try {
    return Response.json(await syncEligiblePlaidItems());
  } catch {
    return Response.json(
      {
        code: "sync_failed",
        message: "Nightly synchronization could not start.",
      },
      { status: 502 },
    );
  }
}
