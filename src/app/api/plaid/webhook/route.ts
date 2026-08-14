import { PlaidFlowError } from "@/lib/plaid/errors";
import { handlePlaidWebhook } from "@/lib/plaid/sync-service";
import { consumeRateLimit, rateLimitSubject } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  // Checked before the body is buffered, so a delivery flood cannot make us
  // read it. The webhook is exempt from the origin gate by design, which makes
  // this the only volumetric control in front of signature verification.
  const verdict = await consumeRateLimit(
    "plaid_webhook",
    rateLimitSubject(request.headers),
  );
  if (!verdict.allowed) {
    return Response.json(
      { code: "rate_limited", message: "Too many webhook deliveries." },
      {
        status: 429,
        headers: { "Retry-After": String(verdict.retryAfterSeconds) },
      },
    );
  }
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
