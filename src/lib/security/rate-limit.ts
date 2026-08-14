import "server-only";

import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logServerEvent } from "./log";

export type RateLimitBucket =
  | "sign_in"
  | "password_reset"
  | "invitation_accept"
  | "password_confirm"
  | "auth_callback"
  | "plaid_webhook";

export type RateLimitVerdict = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

const POLICIES: Record<
  RateLimitBucket,
  { limit: number; windowSeconds: number }
> = {
  sign_in: { limit: 10, windowSeconds: 300 },
  password_reset: { limit: 5, windowSeconds: 900 },
  invitation_accept: { limit: 10, windowSeconds: 900 },
  password_confirm: { limit: 10, windowSeconds: 300 },
  auth_callback: { limit: 30, windowSeconds: 300 },
  plaid_webhook: { limit: 600, windowSeconds: 60 },
};

const UNKNOWN_CLIENT = "unknown-client";

function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return headers.get("x-real-ip")?.trim() || UNKNOWN_CLIENT;
}

/**
 * The subject is hashed so neither a client IP nor an email address is ever
 * written to the counter table or to a log line; the digest is stable enough
 * to count with and useless to anyone reading the row.
 */
export function rateLimitSubject(
  headers: Headers,
  discriminator?: string,
): string {
  return createHash("sha256")
    .update(
      `${clientAddress(headers)}|${discriminator?.trim().toLowerCase() ?? ""}`,
    )
    .digest("hex")
    .slice(0, 32);
}

/**
 * Clears a subject's budget after the identity is proven.
 *
 * Only failures should accumulate against a brute-force control: an attacker's
 * traffic is failures by definition, while a legitimate member — or the browser
 * suite — can sign in far more than the limit in a window and must not lock
 * itself out. Best-effort by design; a failure to clear leaves the attempt
 * counted, which is the safe direction.
 */
export async function resetRateLimit(
  bucket: RateLimitBucket,
  subject: string,
): Promise<void> {
  try {
    const { error } = await createSupabaseAdminClient().rpc(
      "reset_rate_limit",
      { p_bucket: bucket, p_subject: subject },
    );
    if (error) throw error;
  } catch (error) {
    logServerEvent("warn", "Rate limit reset failed", { bucket, error });
  }
}

export async function consumeRateLimit(
  bucket: RateLimitBucket,
  subject: string,
): Promise<RateLimitVerdict> {
  const policy = POLICIES[bucket];
  try {
    const { data, error } = await createSupabaseAdminClient().rpc(
      "consume_rate_limit",
      {
        p_bucket: bucket,
        p_subject: subject,
        p_limit: policy.limit,
        p_window_seconds: policy.windowSeconds,
      },
    );
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as {
      allowed?: boolean;
      remaining?: number;
      retry_after_seconds?: number;
    } | null;
    if (!row) throw new Error("rate limit counter returned no row");
    return {
      allowed: row.allowed === true,
      remaining: Number(row.remaining ?? 0),
      retryAfterSeconds: Number(
        row.retry_after_seconds ?? policy.windowSeconds,
      ),
    };
  } catch (error) {
    // Fail closed. A limiter that could not record the attempt has no basis to
    // admit it, and an outage must not become an open brute-force window.
    logServerEvent("error", "Rate limit check failed", { bucket, error });
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: policy.windowSeconds,
    };
  }
}
