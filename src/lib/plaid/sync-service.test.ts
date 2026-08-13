import {
  createHash,
  generateKeyPairSync,
  sign,
  type JsonWebKey,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  syncTransactions: vi.fn(),
  getWebhookVerificationKey: vi.fn(),
  decryptAccessToken: vi.fn(() => "access-token-must-stay-secret"),
  from: vi.fn(),
}));

vi.mock("@/lib/env/server", () => ({
  getServerEnv: () => ({
    PLAID_TOKEN_ENCRYPTION_KEY: "test-encryption-key",
  }),
}));

vi.mock("@/lib/plaid/crypto", () => ({
  decryptAccessToken: mocks.decryptAccessToken,
}));

vi.mock("@/lib/plaid/provider", () => ({
  getPlaidProvider: () => ({
    syncTransactions: mocks.syncTransactions,
    getWebhookVerificationKey: mocks.getWebhookVerificationKey,
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));

import {
  handlePlaidWebhook,
  syncPlaidItem,
  verifyPlaidWebhook,
} from "./sync-service";

const itemId = "50000000-0000-4000-8000-000000000001";
const actor = {
  userId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000001",
};
const transaction = {
  transactionId: "transaction-1",
  accountId: "provider-chequing",
  amount: 12.5,
  currencyCode: "CAD",
  authorizedDate: null,
  date: "2026-08-11",
  merchantName: "Northern Grocer",
  name: "Northern Grocer",
  pending: false,
  pendingTransactionId: null,
  payload: {},
};

function successfulRpc(name: string, args: Record<string, unknown>) {
  if (name === "claim_plaid_sync") {
    return Promise.resolve({
      data: {
        itemId,
        workspaceId: actor.workspaceId,
        linkedBy: actor.userId,
        accessTokenCiphertext: "010203",
        cursor: "original-cursor",
        institutionName: "Maple Test Bank",
      },
      error: null,
    });
  }
  if (name === "commit_plaid_sync") {
    return Promise.resolve({
      data: {
        added: (args.p_added as unknown[]).length,
        modified: (args.p_modified as unknown[]).length,
        removed: (args.p_removed as unknown[]).length,
        lastSuccessAt: "2026-08-11T22:00:00.000Z",
      },
      error: null,
    });
  }
  return Promise.resolve({ data: null, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decryptAccessToken.mockReturnValue("access-token-must-stay-secret");
  mocks.rpc.mockImplementation(successfulRpc);
  mocks.syncTransactions.mockResolvedValue({
    added: [],
    modified: [],
    removedIds: [],
    nextCursor: "original-cursor",
    hasMore: false,
    requestId: "provider-request-idle",
  });
});

describe("GH-5 Plaid sync orchestration", () => {
  it("API-001 buffers every page and commits once with only the final cursor", async () => {
    mocks.syncTransactions
      .mockResolvedValueOnce({
        added: [transaction],
        modified: [],
        removedIds: [],
        nextCursor: "intermediate-cursor",
        hasMore: true,
        requestId: "provider-request-page-1",
      })
      .mockResolvedValueOnce({
        added: [{ ...transaction, transactionId: "transaction-2" }],
        modified: [{ ...transaction, transactionId: "transaction-modified" }],
        removedIds: ["transaction-removed"],
        nextCursor: "final-cursor",
        hasMore: false,
        requestId: "provider-request-page-2",
      });

    const result = await syncPlaidItem(itemId, "member", actor);
    const commitCalls = mocks.rpc.mock.calls.filter(
      ([name]) => name === "commit_plaid_sync",
    );

    expect(mocks.syncTransactions).toHaveBeenNthCalledWith(
      1,
      "access-token-must-stay-secret",
      "original-cursor",
    );
    expect(mocks.syncTransactions).toHaveBeenNthCalledWith(
      2,
      "access-token-must-stay-secret",
      "intermediate-cursor",
    );
    expect(commitCalls).toHaveLength(1);
    expect(commitCalls[0]?.[1]).toMatchObject({
      p_original_cursor: "original-cursor",
      p_final_cursor: "final-cursor",
      p_provider_request_id: "provider-request-page-2",
      p_added: [
        transaction,
        expect.objectContaining({ transactionId: "transaction-2" }),
      ],
      p_modified: [
        expect.objectContaining({ transactionId: "transaction-modified" }),
      ],
      p_removed: ["transaction-removed"],
    });
    expect(result).toMatchObject({
      status: "succeeded",
      added: 2,
      modified: 1,
      removed: 1,
      requestId: "provider-request-page-2",
    });
  });

  it("API-003 discards a mutated partial pass and restarts from the original cursor", async () => {
    const mutation = Object.assign(new Error("pagination changed"), {
      response: {
        data: { error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" },
      },
    });
    mocks.syncTransactions
      .mockResolvedValueOnce({
        added: [transaction],
        modified: [],
        removedIds: [],
        nextCursor: "abandoned-page-2",
        hasMore: true,
        requestId: "abandoned-request",
      })
      .mockRejectedValueOnce(mutation)
      .mockResolvedValueOnce({
        added: [{ ...transaction, transactionId: "retry-transaction" }],
        modified: [],
        removedIds: [],
        nextCursor: "retry-page-2",
        hasMore: true,
        requestId: "retry-request-1",
      })
      .mockResolvedValueOnce({
        added: [],
        modified: [],
        removedIds: [],
        nextCursor: "retry-final",
        hasMore: false,
        requestId: "retry-request-2",
      });

    await syncPlaidItem(itemId, "webhook");

    expect(
      mocks.syncTransactions.mock.calls.map(([, cursor]) => cursor),
    ).toEqual([
      "original-cursor",
      "abandoned-page-2",
      "original-cursor",
      "retry-page-2",
    ]);
    const commit = mocks.rpc.mock.calls.find(
      ([name]) => name === "commit_plaid_sync",
    )?.[1];
    expect(commit).toMatchObject({
      p_original_cursor: "original-cursor",
      p_final_cursor: "retry-final",
      p_added: [
        expect.objectContaining({ transactionId: "retry-transaction" }),
      ],
    });
    expect(JSON.stringify(commit)).not.toContain("transaction-1");
  });

  it.each(["claim parsing", "token decryption"])(
    "API-012 records a claimed sync when %s fails",
    async (failurePoint) => {
      if (failurePoint === "claim parsing") {
        mocks.rpc.mockImplementation((name, args) =>
          name === "claim_plaid_sync"
            ? Promise.resolve({
                data: {
                  itemId,
                  workspaceId: actor.workspaceId,
                  linkedBy: actor.userId,
                  accessTokenCiphertext: null,
                  cursor: "original-cursor",
                  institutionName: "Maple Test Bank",
                },
                error: null,
              })
            : successfulRpc(name, args),
        );
      } else {
        mocks.decryptAccessToken.mockImplementationOnce(() => {
          throw new Error("ciphertext could not be decrypted");
        });
      }

      await expect(syncPlaidItem(itemId, "nightly")).rejects.toMatchObject({
        status: 502,
        code: "sync_failed",
      });

      const claimCall = mocks.rpc.mock.calls.find(
        ([name]) => name === "claim_plaid_sync",
      );
      const failureCall = mocks.rpc.mock.calls.find(
        ([name]) => name === "fail_plaid_sync",
      );
      expect(claimCall).toBeDefined();
      expect(failureCall?.[1]).toMatchObject({
        p_item_id: itemId,
        p_request_id: claimCall?.[1].p_request_id,
        p_error_code: "provider_unavailable",
        p_needs_login_repair: false,
      });
      expect(mocks.syncTransactions).not.toHaveBeenCalled();
    },
  );
  it("API-004 maps a competing live claim to a stable sync_in_progress conflict", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "55P03", message: "sync in progress" },
    });

    await expect(syncPlaidItem(itemId, "member", actor)).rejects.toMatchObject({
      status: 409,
      code: "sync_in_progress",
    });
    expect(mocks.syncTransactions).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown", { data: null, error: null }],
    [
      "unavailable",
      { data: null, error: { code: "P0002", message: "item unavailable" } },
    ],
  ])(
    "API-010 maps a member %s Item to the same sanitized forbidden response",
    async (_kind, claimResult) => {
      mocks.rpc.mockResolvedValueOnce(claimResult);

      let caught: unknown;
      try {
        await syncPlaidItem(itemId, "member", actor);
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({
        status: 403,
        code: "forbidden",
        message: "This bank connection is not available.",
      });
      expect(JSON.stringify(caught)).not.toMatch(
        /unknown|unavailable|another member|belongs/i,
      );
      expect(mocks.syncTransactions).not.toHaveBeenCalled();
    },
  );
  it("API-005 maps a foreign Item claim to forbidden before any Plaid call", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "forbidden" },
    });

    await expect(syncPlaidItem(itemId, "member", actor)).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
    expect(mocks.syncTransactions).not.toHaveBeenCalled();
  });

  it("API-012 stores bounded sanitized retry state and returns no provider/database secrets", async () => {
    const providerFailure = Object.assign(
      new Error("access-token-must-stay-secret socket failure"),
      {
        response: {
          data: {
            error_code: "INTERNAL_SERVER_ERROR",
            error_message: "raw financial provider payload",
            request_id: "provider-request-failed",
          },
        },
      },
    );
    mocks.syncTransactions.mockRejectedValue(providerFailure);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    let caught: unknown;
    try {
      await syncPlaidItem(itemId, "nightly");
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ status: 502, code: "sync_failed" });
    const failureCall = mocks.rpc.mock.calls.find(
      ([name]) => name === "fail_plaid_sync",
    );
    expect(failureCall?.[1]).toMatchObject({
      p_item_id: itemId,
      p_error_code: "provider_unavailable",
      p_error_message: "Transaction updates will be retried automatically.",
      p_needs_login_repair: false,
      p_provider_request_id: "provider-request-failed",
    });
    expect(JSON.stringify(failureCall)).not.toMatch(
      /access-token-must-stay-secret|raw financial provider payload|INTERNAL_SERVER_ERROR/,
    );
    expect(JSON.stringify(caught)).not.toMatch(
      /access-token-must-stay-secret|raw financial provider payload|INTERNAL_SERVER_ERROR/,
    );
    expect(warn).toHaveBeenCalledWith(
      "Plaid sync failed",
      expect.objectContaining({
        itemId,
        requestId: expect.any(String),
        providerRequestId: "provider-request-failed",
        errorCode: "provider_unavailable",
      }),
    );
  });

  it("API-013 statically forbids transactions/refresh and secret-bearing logging in sync paths", () => {
    const sources = [
      "src/lib/plaid/sync-service.ts",
      "src/app/api/plaid/webhook/route.ts",
      "src/app/api/plaid/sync/route.ts",
      "src/app/api/internal/plaid-sync/route.ts",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(sources).not.toMatch(
      /transactions\s*\/\s*refresh|transactionsRefresh/i,
    );
    expect(sources).not.toMatch(
      /console\.(?:log|info|warn|error)\([^\n]*(?:accessToken|rawBody|verificationToken|provider_payload)/,
    );
  });
});

describe("GH-5 Plaid webhook verification", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const publicJwk = publicKey.export({ format: "jwk" }) as JsonWebKey;

  function token(
    rawBody: Buffer,
    overrides: { iat?: number; hash?: string } = {},
  ) {
    const header = Buffer.from(
      JSON.stringify({ alg: "ES256", kid: "verification-key-1", typ: "JWT" }),
    ).toString("base64url");
    const claims = Buffer.from(
      JSON.stringify({
        iat: overrides.iat ?? Math.floor(Date.now() / 1000),
        request_body_sha256:
          overrides.hash ?? createHash("sha256").update(rawBody).digest("hex"),
      }),
    ).toString("base64url");
    const signature = sign("sha256", Buffer.from(`${header}.${claims}`), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url");
    return `${header}.${claims}.${signature}`;
  }

  beforeEach(() => {
    mocks.getWebhookVerificationKey.mockResolvedValue({
      alg: "ES256",
      crv: "P-256",
      expiredAt: null,
      kid: "verification-key-1",
      kty: "EC",
      use: "sig",
      x: publicJwk.x,
      y: publicJwk.y,
    });
  });

  it("accepts the explicit null error Plaid sends on TRANSACTIONS updates", async () => {
    // Plaid sends "error": null on INITIAL_UPDATE, HISTORICAL_UPDATE, and
    // DEFAULT_UPDATE. An optional object schema rejects null, which rejected
    // every real transaction webhook with a 400.
    const rawBody = Buffer.from(
      JSON.stringify({
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
        item_id: "provider-item-owned",
        error: null,
        environment: "sandbox",
      }),
    );

    await expect(
      verifyPlaidWebhook(rawBody, token(rawBody)),
    ).resolves.toMatchObject({
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      item_id: "provider-item-owned",
    });
  });

  it("API-006 validates ES256, a fresh iat, and the SHA-256 of the exact raw body", async () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
        item_id: "provider-item-owned",
      }),
    );

    await expect(verifyPlaidWebhook(rawBody, token(rawBody))).resolves.toEqual({
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      item_id: "provider-item-owned",
    });
    expect(mocks.getWebhookVerificationKey).toHaveBeenCalledWith(
      "verification-key-1",
    );
  });

  it.each([
    [
      "non-string item_id",
      {
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
        item_id: 42,
      },
    ],
    [
      "malformed error",
      {
        webhook_type: "ITEM",
        webhook_code: "ERROR",
        item_id: "provider-item-owned",
        error: "ITEM_LOGIN_REQUIRED",
      },
    ],
    [
      "malformed consent",
      {
        webhook_type: "ITEM",
        webhook_code: "PENDING_EXPIRATION",
        item_id: "provider-item-owned",
        consent_expiration_time: 12345,
      },
    ],
    [
      "missing consent",
      {
        webhook_type: "ITEM",
        webhook_code: "PENDING_EXPIRATION",
        item_id: "provider-item-owned",
      },
    ],
    [
      "null consent",
      {
        webhook_type: "ITEM",
        webhook_code: "PENDING_EXPIRATION",
        item_id: "provider-item-owned",
        consent_expiration_time: null,
      },
    ],
  ])(
    "API-007 classifies a signed %s as invalid_webhook_payload",
    async (_case, payload) => {
      const rawBody = Buffer.from(JSON.stringify(payload));
      await expect(
        handlePlaidWebhook(rawBody.toString("utf8"), token(rawBody)),
      ).rejects.toMatchObject({
        status: 400,
        code: "invalid_webhook_payload",
      });
    },
  );

  it.each([
    [
      "header",
      "bm90LWpzb24",
      Buffer.from(
        JSON.stringify({
          iat: Math.floor(Date.now() / 1000),
          request_body_sha256: "0".repeat(64),
        }),
      ).toString("base64url"),
    ],
    [
      "claims",
      Buffer.from(
        JSON.stringify({ alg: "ES256", kid: "verification-key-1" }),
      ).toString("base64url"),
      "bm90LWpzb24",
    ],
  ])(
    "API-007 classifies malformed JWT %s JSON as invalid_webhook, not payload",
    async (_part, header, claims) => {
      await expect(
        handlePlaidWebhook("{}", `${header}.${claims}.signature`),
      ).rejects.toMatchObject({ status: 401, code: "invalid_webhook" });
    },
  );

  it.each(["lookup", "persistence"])(
    "API-009 treats repair-state %s failure as retryable instead of acknowledging",
    async (failurePoint) => {
      const payload = {
        webhook_type: "ITEM",
        webhook_code: "ERROR",
        item_id: "provider-item-owned",
        error: { error_code: "ITEM_LOGIN_REQUIRED" },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const plaidItemsQuery = {
        select: vi.fn(),
        eq: vi.fn(),
        is: vi.fn(),
        maybeSingle: vi.fn(),
      };
      plaidItemsQuery.select.mockReturnValue(plaidItemsQuery);
      plaidItemsQuery.eq.mockReturnValue(plaidItemsQuery);
      plaidItemsQuery.is.mockReturnValue(plaidItemsQuery);
      plaidItemsQuery.maybeSingle.mockResolvedValue(
        failurePoint === "lookup"
          ? { data: null, error: { message: "database unavailable" } }
          : { data: { id: itemId, sync_state: null }, error: null },
      );
      const syncStateQuery = {
        upsert: vi
          .fn()
          .mockResolvedValue({ error: { message: "write failed" } }),
      };
      mocks.from.mockImplementation((table: string) =>
        table === "plaid_items" ? plaidItemsQuery : syncStateQuery,
      );

      await expect(
        handlePlaidWebhook(rawBody.toString("utf8"), token(rawBody)),
      ).rejects.toMatchObject({ status: 502, code: "sync_failed" });
    },
  );

  it("API-009 keeps non-login ITEM errors retryable without setting login repair", async () => {
    const payload = {
      webhook_type: "ITEM",
      webhook_code: "ERROR",
      item_id: "provider-item-owned",
      error: {
        error_code: "INSTITUTION_DOWN",
        request_id: "provider-item-request",
      },
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const plaidItemsQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      is: vi.fn(),
      maybeSingle: vi.fn(),
    };
    plaidItemsQuery.select.mockReturnValue(plaidItemsQuery);
    plaidItemsQuery.eq.mockReturnValue(plaidItemsQuery);
    plaidItemsQuery.is.mockReturnValue(plaidItemsQuery);
    plaidItemsQuery.maybeSingle.mockResolvedValue({
      data: { id: itemId, sync_state: null },
      error: null,
    });
    const syncStateQuery = {
      upsert: vi.fn().mockResolvedValue({ error: null }),
    };
    mocks.from.mockImplementation((table: string) =>
      table === "plaid_items" ? plaidItemsQuery : syncStateQuery,
    );

    await expect(
      handlePlaidWebhook(rawBody.toString("utf8"), token(rawBody)),
    ).resolves.toEqual({ accepted: true });
    expect(syncStateQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error_code: "provider_unavailable",
        needs_login_repair: false,
        provider_request_id: "provider-item-request",
      }),
    );
  });
  it("API-007 rejects stale, body-mismatched, and expired-key verification", async () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
      }),
    );
    await expect(
      verifyPlaidWebhook(
        rawBody,
        token(rawBody, { iat: Math.floor(Date.now() / 1000) - 301 }),
      ),
    ).rejects.toThrow(/stale/i);
    await expect(
      verifyPlaidWebhook(
        Buffer.from(`${rawBody.toString("utf8")} `),
        token(rawBody),
      ),
    ).rejects.toThrow(/body mismatch/i);
    mocks.getWebhookVerificationKey.mockResolvedValueOnce({
      alg: "ES256",
      crv: "P-256",
      expiredAt: Math.floor(Date.now() / 1000) - 1,
      kid: "verification-key-1",
      kty: "EC",
      use: "sig",
      x: publicJwk.x,
      y: publicJwk.y,
    });
    await expect(verifyPlaidWebhook(rawBody, token(rawBody))).rejects.toThrow(
      /invalid webhook key/i,
    );
  });
});
