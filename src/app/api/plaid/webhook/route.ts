import { PlaidFlowError } from "@/lib/plaid/errors";
import { handlePlaidWebhook } from "@/lib/plaid/sync-service";

export async function POST(request: Request) {
  const token = request.headers.get("plaid-verification");
  const rawBody = await request.text();
  if (!token) {
    return Response.json(
      { code: "invalid_webhook", message: "Webhook verification failed." },
      { status: 401 },
    );
  }
  try {
    return Response.json(await handlePlaidWebhook(rawBody, token));
  } catch (error) {
    const candidate = error as { code?: unknown; status?: unknown };
    if (
      candidate.code === "invalid_webhook_payload" &&
      candidate.status === 400
    ) {
      return Response.json(
        {
          code: "invalid_webhook_payload",
          message: "The webhook payload is invalid.",
        },
        { status: 400 },
      );
    }
    if (candidate.code === "invalid_webhook" && candidate.status === 401) {
      return Response.json(
        { code: "invalid_webhook", message: "Webhook verification failed." },
        { status: 401 },
      );
    }
    if (error instanceof PlaidFlowError) {
      return Response.json(
        {
          code: "sync_failed",
          message: "Webhook processing is temporarily unavailable.",
        },
        { status: 502 },
      );
    }
    return Response.json(
      {
        code: "sync_failed",
        message: "Webhook processing is temporarily unavailable.",
      },
      { status: 502 },
    );
  }
}
