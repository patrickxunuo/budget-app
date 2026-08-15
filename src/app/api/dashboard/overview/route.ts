import {
  getDashboardOverviewApiContext,
  readDashboardOverview,
  toDashboardOverviewApiErrorResponse,
} from "@/lib/dashboard/overview-service";
import type { DashboardScope } from "@/lib/dashboard/types";

export const dynamic = "force-dynamic";

const invalidScope = () =>
  Response.json(
    {
      error: "Invalid request.",
      fields: { scope: ["Choose Family or Personal."] },
    },
    { status: 400, headers: { "Cache-Control": "private, no-store" } },
  );

export async function GET(request: Request) {
  const value = new URL(request.url).searchParams.get("scope");
  if (value !== "family" && value !== "personal") return invalidScope();

  try {
    const context = await getDashboardOverviewApiContext();
    const model = await readDashboardOverview(
      context,
      value as DashboardScope,
      new Date(),
    );
    return Response.json(model, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return toDashboardOverviewApiErrorResponse(error);
  }
}
