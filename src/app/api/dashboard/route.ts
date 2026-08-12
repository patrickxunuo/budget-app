import {
  getDashboardApiContext,
  readDashboard,
  toDashboardApiErrorResponse,
} from "@/lib/dashboard/service";
export async function GET(request: Request) {
  try {
    const context = await getDashboardApiContext();
    return Response.json(
      await readDashboard(context, new URL(request.url).searchParams),
    );
  } catch (error) {
    return toDashboardApiErrorResponse(error);
  }
}
