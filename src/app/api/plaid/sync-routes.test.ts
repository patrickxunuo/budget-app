import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({ cronSecret: "cron-secret-value" }));
const db = vi.hoisted(() => ({ maybeSingle: vi.fn() }));

vi.mock("@/lib/env/server", () => ({
  getServerEnv: () => ({ CRON_SECRET: state.cronSecret }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ is: () => ({ maybeSingle: db.maybeSingle }) }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/auth/api", () => {
  class ApiAuthError extends Error {
    constructor(
      public readonly status: 401 | 403,
      public readonly code: "unauthorized" | "inactive_membership",
      message: string,
    ) {
      super(message);
    }
  }
  return { ApiAuthError, requirePlaidApiActor: vi.fn() };
});
vi.mock("@/lib/plaid/sync-service", () => ({
  syncPlaidItem: vi.fn(),
  verifyPlaidWebhook: vi.fn(),
  handlePlaidWebhook: vi.fn(),
  getPlaidSyncStatuses: vi.fn(),
  markPlaidItemAttention: vi.fn(),
  syncEligiblePlaidItems: vi.fn(),
}));

import {
  ApiAuthError,
  requirePlaidApiActor,
  type PlaidApiActor,
} from "@/lib/auth/api";
import { PlaidFlowError } from "@/lib/plaid/errors";
import * as syncService from "@/lib/plaid/sync-service";
import { GET as nightlySync } from "@/app/api/internal/plaid-sync/route";
import { POST as memberSync } from "./sync/route";
import { GET as memberStatus } from "./status/route";
import { POST as webhook } from "./webhook/route";

const actor: PlaidApiActor = {
  userId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000001",
  membershipId: "30000000-0000-4000-8000-000000000001",
};
const itemId = "50000000-0000-4000-8000-000000000001";
const syncPayload = {
  webhook_type: "TRANSACTIONS",
  webhook_code: "SYNC_UPDATES_AVAILABLE",
  item_id: "provider-item-owned",
};

function request(path: string, init: RequestInit & { json?: unknown } = {}) {
  const { json, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);
  let body = requestInit.body;
  if (json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(json);
  }
  return new Request(`http://localhost${path}`, {
    ...requestInit,
    headers,
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.maybeSingle.mockResolvedValue({ data: { id: itemId }, error: null });
  vi.mocked(requirePlaidApiActor).mockResolvedValue(actor);
  vi.mocked(syncService.verifyPlaidWebhook).mockResolvedValue(syncPayload);
  vi.mocked(syncService.handlePlaidWebhook).mockResolvedValue({
    accepted: true,
  });
  vi.mocked(syncService.syncPlaidItem).mockResolvedValue({
    itemId,
    status: "succeeded",
    added: 2,
    modified: 1,
    removed: 1,
    requestId: "request-safe",
    lastSuccessAt: "2026-08-11T22:00:00.000Z",
  });
  vi.mocked(syncService.getPlaidSyncStatuses).mockResolvedValue([]);
  vi.mocked(syncService.markPlaidItemAttention).mockResolvedValue(true);
  vi.mocked(syncService.syncEligiblePlaidItems).mockResolvedValue({
    attempted: 3,
    succeeded: 2,
    skipped: 1,
    failed: 0,
  });
});

describe("GH-5 Plaid sync route acceptance", () => {
  it("API-006 verifies the exact body and starts sync for valid SYNC_UPDATES_AVAILABLE", async () => {
    const rawBody = JSON.stringify(syncPayload);
    const response = await webhook(
      request("/api/plaid/webhook", {
        method: "POST",
        headers: { "Plaid-Verification": "signed-es256-jwt" },
        body: rawBody,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true });
    expect(syncService.handlePlaidWebhook).toHaveBeenCalledExactlyOnceWith(
      rawBody,
      "signed-es256-jwt",
    );
  });

  it.each([
    ["missing", undefined],
    ["invalid", "invalid-jwt"],
    ["stale", "stale-jwt"],
    ["expired-key", "expired-key-jwt"],
    ["body-mismatch", "body-mismatch-jwt"],
  ])(
    "API-007 rejects %s signature without invoking sync",
    async (_case, signature) => {
      if (signature) {
        vi.mocked(syncService.handlePlaidWebhook).mockRejectedValue(
          Object.assign(new Error("verification failed"), {
            code: "invalid_webhook",
            status: 401,
          }),
        );
      }
      const response = await webhook(
        request("/api/plaid/webhook", {
          method: "POST",
          headers: signature ? { "Plaid-Verification": signature } : {},
          body: JSON.stringify(syncPayload),
        }),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        code: "invalid_webhook",
        message: "Webhook verification failed.",
      });
      expect(syncService.syncPlaidItem).not.toHaveBeenCalled();
    },
  );

  it("API-007 rejects invalid JSON/schema as invalid_webhook_payload", async () => {
    vi.mocked(syncService.handlePlaidWebhook).mockRejectedValue(
      Object.assign(new SyntaxError("invalid webhook payload"), {
        code: "invalid_webhook_payload",
        status: 400,
      }),
    );
    const response = await webhook(
      request("/api/plaid/webhook", {
        method: "POST",
        headers: { "Plaid-Verification": "valid-for-bad-json" },
        body: "{not-json",
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "invalid_webhook_payload",
    });
    expect(syncService.syncPlaidItem).not.toHaveBeenCalled();
  });

  it.each([
    [
      "irrelevant",
      {
        webhook_type: "TRANSACTIONS",
        webhook_code: "DEFAULT_UPDATE",
        item_id: "provider-item-owned",
      },
    ],
    ["unknown Item", syncPayload],
  ])(
    "API-008 acknowledges a valid %s webhook without disclosure or sync",
    async (_case, payload) => {
      vi.mocked(syncService.handlePlaidWebhook).mockResolvedValue({
        accepted: true,
      });
      if (_case === "unknown Item") {
        db.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      }
      const response = await webhook(
        request("/api/plaid/webhook", {
          method: "POST",
          headers: { "Plaid-Verification": "valid-jwt" },
          body: JSON.stringify(payload),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ accepted: true });
      expect(JSON.stringify(body)).not.toContain(payload.item_id);
      expect(syncService.syncPlaidItem).not.toHaveBeenCalled();
    },
  );

  it("API-009 persists sanitized login-repair/consent state and returns it from status", async () => {
    const status = {
      itemId,
      institutionName: "Maple Test Bank",
      status: "failed" as const,
      lastAttemptAt: "2026-08-11T21:00:00.000Z",
      lastSuccessAt: null,
      nextRetryAt: null,
      errorCode: "login_required",
      needsLoginRepair: true,
      consentExpiresAt: "2026-08-18T21:00:00.000Z",
    };
    vi.mocked(syncService.handlePlaidWebhook).mockResolvedValue({
      accepted: true,
    });
    vi.mocked(syncService.getPlaidSyncStatuses).mockResolvedValue([status]);

    const webhookResponse = await webhook(
      request("/api/plaid/webhook", {
        method: "POST",
        headers: { "Plaid-Verification": "valid-item-error-jwt" },
        body: JSON.stringify({ raw_provider_detail: "must-not-return" }),
      }),
    );
    const statusResponse = await memberStatus();
    const body = await statusResponse.json();

    expect(webhookResponse.status).toBe(200);
    expect(syncService.handlePlaidWebhook).toHaveBeenCalledWith(
      expect.any(String),
      "valid-item-error-jwt",
    );

    vi.mocked(syncService.handlePlaidWebhook).mockResolvedValueOnce({
      accepted: true,
    });
    await webhook(
      request("/api/plaid/webhook", {
        method: "POST",
        headers: { "Plaid-Verification": "valid-consent-jwt" },
        body: JSON.stringify({ event: "pending-expiration" }),
      }),
    );
    expect(syncService.handlePlaidWebhook).toHaveBeenCalledWith(
      expect.any(String),
      "valid-consent-jwt",
    );
    expect(statusResponse.status).toBe(200);
    expect(body).toEqual({ items: [status] });
    expect(JSON.stringify(body)).not.toMatch(/must-not-return|access.?token/i);
  });

  it("API-010 permits the active owner and rejects anonymous, inactive, and foreign members", async () => {
    const owned = await memberSync(
      request("/api/plaid/sync", { method: "POST", json: { itemId } }),
    );
    expect(owned.status).toBe(200);
    expect(syncService.syncPlaidItem).toHaveBeenCalledWith(
      itemId,
      "member",
      actor,
    );

    const failures = [
      new ApiAuthError(401, "unauthorized", "Sign in to continue."),
      new ApiAuthError(
        403,
        "inactive_membership",
        "An active membership is required.",
      ),
      new PlaidFlowError(403, "forbidden", "This Item is not available."),
    ];
    for (const failure of failures) {
      vi.clearAllMocks();
      if (failure instanceof ApiAuthError) {
        vi.mocked(requirePlaidApiActor).mockRejectedValueOnce(failure);
      } else {
        vi.mocked(requirePlaidApiActor).mockResolvedValueOnce(actor);
        vi.mocked(syncService.syncPlaidItem).mockRejectedValueOnce(failure);
      }
      const response = await memberSync(
        request("/api/plaid/sync", { method: "POST", json: { itemId } }),
      );
      expect(response.status).toBe(failure.status);
    }
  });

  it("API-009 returns a retryable non-2xx when repair-state persistence fails", async () => {
    vi.mocked(syncService.handlePlaidWebhook).mockRejectedValueOnce(
      new PlaidFlowError(
        502,
        "sync_failed",
        "Repair state could not be saved.",
      ),
    );

    const response = await webhook(
      request("/api/plaid/webhook", {
        method: "POST",
        headers: { "Plaid-Verification": "valid-item-error-jwt" },
        body: JSON.stringify({
          webhook_type: "ITEM",
          webhook_code: "ERROR",
          item_id: "provider-item-owned",
          error: { error_code: "ITEM_LOGIN_REQUIRED" },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(body).not.toEqual({ accepted: true });
    expect(JSON.stringify(body)).not.toMatch(
      /Repair state could not be saved|provider-item-owned/i,
    );
  });

  it.each(["unknown", "unavailable"])(
    "API-010 gives a member a sanitized forbidden response for an %s Item",
    async () => {
      vi.mocked(syncService.syncPlaidItem).mockRejectedValueOnce(
        new PlaidFlowError(
          403,
          "forbidden",
          "This bank connection is not available.",
        ),
      );
      const response = await memberSync(
        request("/api/plaid/sync", { method: "POST", json: { itemId } }),
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toEqual({
        code: "forbidden",
        message: "This bank connection is not available.",
      });
      expect(JSON.stringify(body)).not.toMatch(
        /unknown|unavailable|another member|belongs/i,
      );
    },
  );
  it("API-011 protects nightly recovery with its bearer and reports sanitized counts", async () => {
    const wrong = await nightlySync(
      request("/api/internal/plaid-sync", {
        method: "GET",
        headers: { authorization: "Bearer wrong-secret" },
      }),
    );
    expect(wrong.status).toBe(401);
    expect(syncService.syncEligiblePlaidItems).not.toHaveBeenCalled();

    const valid = await nightlySync(
      request("/api/internal/plaid-sync", {
        method: "GET",
        headers: { authorization: "Bearer cron-secret-value" },
      }),
    );
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({
      attempted: 3,
      succeeded: 2,
      skipped: 1,
      failed: 0,
    });
  });
});

