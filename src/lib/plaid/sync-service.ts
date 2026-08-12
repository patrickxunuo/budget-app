import "server-only";

import {
  createHash,
  createPublicKey,
  randomUUID,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import { z } from "zod";

import type { PlaidApiActor } from "@/lib/auth/api";
import { getServerEnv } from "@/lib/env/server";
import { decryptAccessToken } from "@/lib/plaid/crypto";
import { PlaidFlowError } from "@/lib/plaid/errors";
import { getPlaidProvider } from "@/lib/plaid/provider";
import type {
  PlaidWebhookPayload,
  ProviderTransaction,
  SyncResult,
  SyncStatus,
  SyncTrigger,
} from "@/lib/plaid/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const syncClaimSchema = z.object({
  itemId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  linkedBy: z.string().uuid(),
  accessTokenCiphertext: z.string().regex(/^[a-f0-9]+$/i),
  cursor: z.string().nullable(),
  institutionName: z.string().min(1),
});

const webhookPayloadSchema = z
  .object({
    webhook_type: z.string().min(1).max(100),
    webhook_code: z.string().min(1).max(100),
    item_id: z.string().min(1).max(200).optional(),
    error: z
      .object({
        error_code: z.string().min(1).max(100).optional(),
        request_id: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,200}$/)
          .optional(),
      })
      .passthrough()
      .optional(),
    consent_expiration_time: z
      .union([z.string().datetime({ offset: true }), z.null()])
      .optional(),
  })
  .passthrough();

class InvalidWebhookPayloadError extends Error {}

function decodeJwtPart(part: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    throw new Error("invalid webhook token encoding");
  }
}

function plaidErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const value = error as {
    code?: unknown;
    response?: { data?: { error_code?: unknown } };
  };
  const code = value.response?.data?.error_code ?? value.code;
  return typeof code === "string" ? code : null;
}

function plaidProviderRequestId(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const requestId = (
    error as { response?: { data?: { request_id?: unknown } } }
  ).response?.data?.request_id;
  return typeof requestId === "string" &&
    /^[A-Za-z0-9_-]{1,200}$/.test(requestId)
    ? requestId
    : null;
}

function isMutationDuringPagination(error: unknown) {
  return (
    plaidErrorCode(error) === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"
  );
}

const LOGIN_REPAIR_CODES = new Set([
  "ITEM_LOGIN_REQUIRED",
  "INVALID_CREDENTIALS",
]);

function isLoginRepairError(code: string | null) {
  return code !== null && LOGIN_REPAIR_CODES.has(code);
}

function sanitizedFailure(error: unknown) {
  const providerCode = plaidErrorCode(error);
  const code = isLoginRepairError(providerCode)
    ? "login_required"
    : providerCode === "PRODUCT_NOT_READY"
      ? "product_not_ready"
      : "provider_unavailable";
  return {
    code,
    message:
      code === "login_required"
        ? "Reconnect this institution to resume updates."
        : "Transaction updates will be retried automatically.",
    needsLoginRepair: code === "login_required",
    providerRequestId: plaidProviderRequestId(error),
  };
}

async function recordFailure(
  itemId: string,
  requestId: string,
  error: unknown,
) {
  const admin = createSupabaseAdminClient();
  const failure = sanitizedFailure(error);
  const { error: failureError } = await admin.rpc("fail_plaid_sync", {
    p_item_id: itemId,
    p_request_id: requestId,
    p_error_code: failure.code,
    p_error_message: failure.message,
    p_needs_login_repair: failure.needsLoginRepair,
    p_provider_request_id: failure.providerRequestId,
  });
  if (failureError) {
    // The RPC is the normal atomic release. This checked fallback ensures a
    // post-claim decoding/provider error does not leave a live claim merely
    // because the stored procedure could not be invoked.
    const now = new Date().toISOString();
    const { error: releaseError } = await admin
      .from("sync_state")
      .update({
        status: "failed",
        last_failure_at: now,
        last_failure_request_id: requestId,
        provider_request_id: failure.providerRequestId,
        error_code: failure.code,
        error_message: failure.message,
        ...(failure.needsLoginRepair ? { needs_login_repair: true } : {}),
        next_retry_at: new Date(Date.now() + 60_000).toISOString(),
        current_request_id: null,
        current_trigger: null,
        claim_started_at: null,
      })
      .eq("plaid_item_id", itemId)
      .eq("current_request_id", requestId);
    if (releaseError) {
      console.error("Plaid sync claim release failed", { itemId, requestId });
      throw new Error("sync failure state could not be persisted");
    }
  }
  console.warn("Plaid sync failed", {
    itemId,
    requestId,
    providerRequestId: failure.providerRequestId,
    errorCode: failure.code,
  });
}

export async function syncPlaidItem(
  itemId: string,
  trigger: SyncTrigger,
  actor?: Pick<PlaidApiActor, "workspaceId" | "userId">,
): Promise<SyncResult> {
  const admin = createSupabaseAdminClient();
  const requestId = randomUUID();
  const { data, error } = await admin.rpc("claim_plaid_sync", {
    p_item_id: itemId,
    p_request_id: requestId,
    p_trigger: trigger,
    p_workspace_id: actor?.workspaceId ?? null,
    p_profile_id: actor?.userId ?? null,
  });
  if (error) {
    if (error.code === "55P03" || error.message?.includes("sync in progress")) {
      throw new PlaidFlowError(
        409,
        "sync_in_progress",
        "This account is already checking for updates.",
      );
    }
    if (
      error.code === "42501" ||
      error.code === "P0002" ||
      error.message?.includes("forbidden") ||
      error.message?.includes("item unavailable")
    ) {
      throw new PlaidFlowError(
        403,
        "forbidden",
        "This bank connection is not available.",
      );
    }
    if (error.code === "55000" || error.message?.includes("retry not due")) {
      return {
        itemId,
        status: "idle",
        added: 0,
        modified: 0,
        removed: 0,
        requestId: null,
        lastSuccessAt: null,
      };
    }
    throw new PlaidFlowError(
      502,
      "sync_failed",
      "Updates are temporarily unavailable. Please try again later.",
    );
  }

  if (actor && data === null) {
    throw new PlaidFlowError(
      403,
      "forbidden",
      "This bank connection is not available.",
    );
  }

  try {
    const claim = syncClaimSchema.parse(data);
    const originalCursor = claim.cursor;
    const accessToken = decryptAccessToken(
      Buffer.from(claim.accessTokenCiphertext, "hex"),
      getServerEnv().PLAID_TOKEN_ENCRYPTION_KEY,
    );

    for (let restart = 0; restart < 3; restart += 1) {
      const added: ProviderTransaction[] = [];
      const modified: ProviderTransaction[] = [];
      const removedIds: string[] = [];
      const providerRequestIds: string[] = [];
      let cursor = originalCursor ?? undefined;
      try {
        do {
          const page = await getPlaidProvider().syncTransactions(
            accessToken,
            cursor,
          );
          added.push(...page.added);
          modified.push(...page.modified);
          removedIds.push(...page.removedIds);
          providerRequestIds.push(page.requestId);
          cursor = page.nextCursor;
          if (!page.hasMore) break;
        } while (true);

        const { data: committed, error: commitError } = await admin.rpc(
          "commit_plaid_sync",
          {
            p_item_id: itemId,
            p_request_id: requestId,
            p_original_cursor: originalCursor,
            p_final_cursor: cursor ?? originalCursor,
            p_provider_request_id: providerRequestIds.at(-1) ?? null,
            p_added: added,
            p_modified: modified,
            p_removed: removedIds,
          },
        );
        if (commitError) throw commitError;
        const result = committed as {
          added: number;
          modified: number;
          removed: number;
          lastSuccessAt: string;
        };
        console.info("Plaid sync completed", {
          itemId,
          requestId,
          providerRequestId: providerRequestIds.at(-1) ?? null,
        });
        return {
          itemId,
          status:
            added.length || modified.length || removedIds.length
              ? "succeeded"
              : "idle",
          added: result.added,
          modified: result.modified,
          removed: result.removed,
          requestId: providerRequestIds.at(-1) ?? null,
          lastSuccessAt: result.lastSuccessAt,
        };
      } catch (pageError) {
        if (isMutationDuringPagination(pageError) && restart < 2) continue;
        throw pageError;
      }
    }
    throw new Error("pagination restart limit exceeded");
  } catch (syncError) {
    await recordFailure(itemId, requestId, syncError);
    throw new PlaidFlowError(
      502,
      "sync_failed",
      isLoginRepairError(plaidErrorCode(syncError))
        ? "Reconnect this institution before checking again."
        : "Updates are temporarily unavailable. Please try again later.",
    );
  }
}

export async function getPlaidSyncStatuses(
  actor: Pick<PlaidApiActor, "workspaceId" | "userId">,
): Promise<SyncStatus[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("plaid_items")
    .select(
      "id,institution_name,sync_state(status,last_attempt_at,last_success_at,next_retry_at,error_code,needs_login_repair,consent_expires_at)",
    )
    .eq("workspace_id", actor.workspaceId)
    .eq("linked_by", actor.userId)
    .eq("status", "active")
    .is("archived_at", null);
  if (error) {
    throw new PlaidFlowError(
      502,
      "sync_failed",
      "Freshness details are temporarily unavailable.",
    );
  }
  return (data ?? []).map((item) => {
    const relation = Array.isArray(item.sync_state)
      ? item.sync_state[0]
      : item.sync_state;
    return {
      itemId: item.id as string,
      institutionName: item.institution_name as string,
      status: (relation?.status ?? "idle") as SyncStatus["status"],
      lastAttemptAt: relation?.last_attempt_at ?? null,
      lastSuccessAt: relation?.last_success_at ?? null,
      nextRetryAt: relation?.next_retry_at ?? null,
      errorCode: relation?.error_code ?? null,
      needsLoginRepair: relation?.needs_login_repair ?? false,
      consentExpiresAt: relation?.consent_expires_at ?? null,
    };
  });
}

export async function markPlaidItemAttention(
  providerItemId: string,
  attention: {
    needsLoginRepair?: boolean;
    consentExpiresAt?: string | null;
    errorCode?: string | null;
    providerRequestId?: string | null;
  },
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data: item, error: lookupError } = await admin
    .from("plaid_items")
    .select(
      "id,sync_state(status,error_code,needs_login_repair,consent_expires_at)",
    )
    .eq("plaid_item_id", providerItemId)
    .eq("status", "active")
    .is("archived_at", null)
    .maybeSingle();
  if (lookupError) {
    throw new PlaidFlowError(
      502,
      "sync_failed",
      "Bank connection state is temporarily unavailable.",
    );
  }
  if (!item) return false;
  const previous = Array.isArray(item.sync_state)
    ? item.sync_state[0]
    : item.sync_state;
  const needsLoginRepair =
    previous?.needs_login_repair || attention.needsLoginRepair || false;
  const errorCode = attention.errorCode ?? previous?.error_code ?? null;
  const row = {
    plaid_item_id: item.id,
    status: errorCode ? "failed" : "idle",
    error_code: errorCode,
    error_message: errorCode
      ? needsLoginRepair
        ? "Reconnect this institution to resume updates."
        : "Transaction updates will be retried automatically."
      : null,
    needs_login_repair: needsLoginRepair,
    consent_expires_at:
      attention.consentExpiresAt === undefined
        ? (previous?.consent_expires_at ?? null)
        : attention.consentExpiresAt,
    ...(errorCode ? { last_failure_at: new Date().toISOString() } : {}),
    ...(attention.providerRequestId !== undefined
      ? { provider_request_id: attention.providerRequestId }
      : {}),
    current_request_id: null,
    current_trigger: null,
    claim_started_at: null,
  };
  const { error } = await admin.from("sync_state").upsert(row);
  if (error) {
    throw new PlaidFlowError(
      502,
      "sync_failed",
      "Bank connection state could not be saved.",
    );
  }
  return true;
}

export async function verifyPlaidWebhook(
  rawBody: Buffer | string,
  verificationToken: string,
): Promise<PlaidWebhookPayload> {
  const parts = verificationToken.split(".");
  if (parts.length !== 3) throw new Error("invalid webhook token");
  const encodedHeader = parts[0]!;
  const encodedClaims = parts[1]!;
  const encodedSignature = parts[2]!;
  const header = decodeJwtPart(encodedHeader) as {
    alg?: unknown;
    kid?: unknown;
  };
  const claims = decodeJwtPart(encodedClaims) as {
    iat?: unknown;
    request_body_sha256?: unknown;
  };
  if (header.alg !== "ES256" || typeof header.kid !== "string") {
    throw new Error("invalid webhook algorithm");
  }
  if (
    typeof claims.iat !== "number" ||
    Math.abs(Date.now() / 1000 - claims.iat) > 300
  ) {
    throw new Error("stale webhook token");
  }
  if (
    typeof claims.request_body_sha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(claims.request_body_sha256)
  ) {
    throw new Error("invalid webhook body hash");
  }
  const key = await getPlaidProvider().getWebhookVerificationKey(header.kid);
  if (
    key.alg !== "ES256" ||
    key.kty !== "EC" ||
    key.crv !== "P-256" ||
    key.use !== "sig" ||
    key.kid !== header.kid ||
    (key.expiredAt !== null && key.expiredAt <= Date.now() / 1000)
  ) {
    throw new Error("invalid webhook key");
  }
  const publicKey = createPublicKey({
    key: { kty: key.kty, crv: key.crv, x: key.x, y: key.y },
    format: "jwk",
  });
  const signed = Buffer.from(`${encodedHeader}.${encodedClaims}`);
  const signature = Buffer.from(encodedSignature, "base64url");
  if (
    !verifySignature(
      "sha256",
      signed,
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      signature,
    )
  ) {
    throw new Error("invalid webhook signature");
  }
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  const digest = createHash("sha256").update(body).digest();
  const claimedDigest = Buffer.from(claims.request_body_sha256, "hex");
  if (
    digest.length !== claimedDigest.length ||
    !timingSafeEqual(digest, claimedDigest)
  ) {
    throw new Error("webhook body mismatch");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(body.toString("utf8"));
  } catch {
    throw new InvalidWebhookPayloadError("invalid webhook JSON");
  }
  const parsed = webhookPayloadSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new InvalidWebhookPayloadError("invalid webhook schema");
  }
  const payload = parsed.data;
  const recognizedItemEvent =
    payload.webhook_type === "TRANSACTIONS" &&
    payload.webhook_code === "SYNC_UPDATES_AVAILABLE";
  const recognizedAttentionEvent =
    payload.webhook_type === "ITEM" &&
    (payload.webhook_code === "ERROR" ||
      payload.webhook_code === "PENDING_EXPIRATION");
  if ((recognizedItemEvent || recognizedAttentionEvent) && !payload.item_id) {
    throw new InvalidWebhookPayloadError("missing webhook item identity");
  }
  if (
    payload.webhook_type === "ITEM" &&
    payload.webhook_code === "ERROR" &&
    !payload.error?.error_code
  ) {
    throw new InvalidWebhookPayloadError("missing webhook error code");
  }
  if (
    payload.webhook_type === "ITEM" &&
    payload.webhook_code === "PENDING_EXPIRATION" &&
    typeof payload.consent_expiration_time !== "string"
  ) {
    throw new InvalidWebhookPayloadError("missing consent expiration time");
  }
  return payload;
}

export async function handlePlaidWebhook(
  rawBody: string,
  verificationToken: string,
): Promise<{ accepted: true }> {
  let payload: PlaidWebhookPayload;
  try {
    payload = await verifyPlaidWebhook(rawBody, verificationToken);
  } catch (cause) {
    const invalidPayload = cause instanceof InvalidWebhookPayloadError;
    throw Object.assign(
      new Error(
        invalidPayload
          ? "The webhook payload is invalid."
          : "Webhook verification failed.",
      ),
      {
        code: invalidPayload ? "invalid_webhook_payload" : "invalid_webhook",
        status: invalidPayload ? 400 : 401,
      },
    );
  }

  if (!payload.item_id) return { accepted: true };
  if (
    payload.webhook_type === "TRANSACTIONS" &&
    payload.webhook_code === "SYNC_UPDATES_AVAILABLE"
  ) {
    const admin = createSupabaseAdminClient();
    const { data: item, error } = await admin
      .from("plaid_items")
      .select("id")
      .eq("plaid_item_id", payload.item_id)
      .eq("status", "active")
      .is("archived_at", null)
      .maybeSingle();
    if (error) {
      throw new PlaidFlowError(
        502,
        "sync_failed",
        "Webhook processing is temporarily unavailable.",
      );
    }
    if (item) await syncPlaidItem(item.id as string, "webhook");
  } else if (
    payload.webhook_type === "ITEM" &&
    payload.webhook_code === "ERROR"
  ) {
    const providerCode = payload.error?.error_code ?? null;
    const loginRepair = isLoginRepairError(providerCode);
    await markPlaidItemAttention(payload.item_id, {
      needsLoginRepair: loginRepair,
      errorCode: loginRepair ? "login_required" : "provider_unavailable",
      providerRequestId: payload.error?.request_id ?? null,
      ...(payload.consent_expiration_time !== undefined
        ? { consentExpiresAt: payload.consent_expiration_time }
        : {}),
    });
  } else if (
    payload.webhook_type === "ITEM" &&
    payload.webhook_code === "PENDING_EXPIRATION"
  ) {
    await markPlaidItemAttention(payload.item_id, {
      consentExpiresAt: payload.consent_expiration_time ?? null,
    });
  }
  return { accepted: true };
}

export const getMemberSyncStatuses = getPlaidSyncStatuses;

export async function syncEligiblePlaidItems() {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("plaid_items")
    .select("id,sync_state(status,next_retry_at,claim_started_at)")
    .eq("status", "active")
    .is("archived_at", null);
  if (error) throw new Error("eligible sync lookup failed");
  const report = { attempted: 0, succeeded: 0, skipped: 0, failed: 0 };
  for (const item of data ?? []) {
    const state = Array.isArray(item.sync_state)
      ? item.sync_state[0]
      : item.sync_state;
    const active =
      state?.status === "running" &&
      state.claim_started_at &&
      Date.parse(state.claim_started_at) > Date.now() - 15 * 60_000;
    const backedOff =
      state?.next_retry_at && Date.parse(state.next_retry_at) > Date.now();
    if (active || backedOff) {
      report.skipped += 1;
      continue;
    }
    report.attempted += 1;
    try {
      await syncPlaidItem(item.id as string, "nightly");
      report.succeeded += 1;
    } catch {
      report.failed += 1;
    }
  }
  return report;
}
