import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const db = vi.hoisted(() => ({
  queues: new Map<string, Array<{ data: unknown; error: unknown }>>(),
  rpc: vi.fn(),
  updates: [] as Array<{ table: string; values: unknown }>,
  filters: [] as Array<{ table: string; method: string; args: unknown[] }>,
}));
const provider = vi.hoisted(() => ({
  createUpdateLinkToken: vi.fn(),
  getAccounts: vi.fn(),
  removeItem: vi.fn(),
}));
const env = vi.hoisted(() => ({
  PLAID_TOKEN_ENCRYPTION_KEY: "test-key",
  PLAID_WEBHOOK_URL: "https://example.test/plaid/webhook",
  APP_URL: "https://app.example.test",
}));

function resultFor(table: string) {
  const result = db.queues.get(table)?.shift();
  if (!result) throw new Error(`No queued database result for ${table}`);
  return result;
}
function builder(table: string) {
  const result = resultFor(table);
  const query: Record<string, unknown> = {};
  for (const method of [
    "select",
    "eq",
    "neq",
    "gt",
    "in",
    "is",
    "order",
    "limit",
  ]) {
    query[method] = vi.fn((...args: unknown[]) => {
      db.filters.push({ table, method, args });
      return query;
    });
  }
  query.maybeSingle = vi.fn(async () => result);
  query.single = vi.fn(async () => result);
  query.update = vi.fn((values: unknown) => {
    db.updates.push({ table, values });
    return query;
  });
  query.then = (
    resolve: (value: { data: unknown; error: unknown }) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return query;
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => builder(table),
    rpc: db.rpc,
  }),
}));
vi.mock("@/lib/env/server", () => ({ getServerEnv: () => env }));
vi.mock("./provider", () => ({ getPlaidProvider: () => provider }));
vi.mock("./service", () => ({
  oauthRedirectUri: (appUrl: string) => `${appUrl}/accounts/oauth-return`,
}));
vi.mock("./crypto", () => ({
  parseBytea: vi.fn(() => new Uint8Array([1, 2, 3])),
  decryptAccessToken: vi.fn(() => "access-decrypted-item-token"),
}));

import {
  changePlaidAccountVisibility,
  createPlaidUpdateToken,
  disconnectPlaidConnection,
  getPlaidConnections,
  reconcilePlaidConnection,
} from "./connection-management";

const actor = {
  userId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000001",
  membershipId: "30000000-0000-4000-8000-000000000001",
};
const itemId = "40000000-0000-4000-8000-000000000001";
const accountId = "50000000-0000-4000-8000-000000000001";
const activeItem = {
  id: itemId,
  workspace_id: actor.workspaceId,
  linked_by: actor.userId,
  institution_name: "Maple Test Bank",
  access_token_ciphertext: "\\x010203",
  status: "active" as "active" | "error" | "pending" | "revoked",
  archived_at: null,
  disconnected_at: null as string | null,
};
const pendingItem = {
  ...activeItem,
  id: "40000000-0000-4000-8000-000000000099",
  status: "pending" as const,
};
const account = {
  id: accountId,
  provider_account_id: "provider-chequing",
  display_name: "Everyday Chequing",
  name: "Everyday Chequing",
  mask: "1204",
  subtype: "chequing",
  scope: "personal",
  owner_profile_id: actor.userId,
  available_balance_cents: 10000,
  current_balance_cents: 11000,
  balance_updated_at: "2026-08-12T18:00:00.000Z",
  archived_at: null,
  lifecycle: "live",
  read_only: false,
};

function queue(table: string, data: unknown, error: unknown = null) {
  const entries = db.queues.get(table) ?? [];
  entries.push({ data, error });
  db.queues.set(table, entries);
}
function queueOwnedItem(item = activeItem) {
  queue("workspace_memberships", { id: actor.membershipId });
  queue("plaid_items", item);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.queues.clear();
  db.updates.length = 0;
  db.filters.length = 0;
  db.rpc.mockImplementation(async (name: string) => {
    if (name === "claim_plaid_disconnect") {
      return { data: "claimed", error: null };
    }
    return { data: null, error: null };
  });
  provider.createUpdateLinkToken.mockResolvedValue({
    linkToken: "link-update-safe",
    expiration: "2026-08-12T19:00:00.000Z",
  });
  provider.getAccounts.mockResolvedValue([]);
  provider.removeItem.mockResolvedValue(undefined);
});

describe("GH-11 Plaid connection management service", () => {
  it("requires an explicit literal acknowledgement before visibility can change", async () => {
    await expect(
      changePlaidAccountVisibility(actor, itemId, {
        accountId,
        scope: "family",
        acknowledgeRetroactiveImpact: false,
      }),
    ).rejects.toMatchObject({ status: 400, code: "invalid_request" });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("API-001 excludes pending review Items from the management dossier", async () => {
    queue("workspace_memberships", { id: actor.membershipId });
    queue("plaid_items", [activeItem]);
    queue("accounts", [account]);
    queue("sync_state", {
      last_success_at: "2026-08-12T18:00:00.000Z",
      consent_expires_at: null,
      needs_login_repair: false,
      status: "succeeded",
    });
    queue("profiles", [
      { id: actor.userId, display_name: "Connection Linker" },
    ]);

    const connections = await getPlaidConnections(actor);

    expect(connections).toHaveLength(1);
    expect(connections[0]?.itemId).toBe(itemId);
    expect(
      connections.some((connection) => connection.itemId === pendingItem.id),
    ).toBe(false);
    expect(
      db.filters.some(
        (filter) =>
          filter.table === "plaid_items" &&
          ((filter.method === "neq" &&
            filter.args[0] === "status" &&
            filter.args[1] === "pending") ||
            (filter.method === "in" &&
              filter.args[0] === "status" &&
              Array.isArray(filter.args[1]) &&
              !filter.args[1].includes("pending"))),
      ),
    ).toBe(true);
  });

  it.each([
    "login_repair",
    "consent",
    "permissions",
    "account_selection",
  ] as const)(
    "API-006 sends the decrypted Item token and %s context to the provider",
    async (reason) => {
      queueOwnedItem();
      queue("accounts", [account]);

      const result = await createPlaidUpdateToken(actor, itemId, { reason });

      expect(provider.createUpdateLinkToken).toHaveBeenCalledExactlyOnceWith({
        userId: actor.userId,
        accessToken: "access-decrypted-item-token",
        reason,
        webhookUrl: env.PLAID_WEBHOOK_URL,
        redirectUri: `${env.APP_URL}/accounts/oauth-return`,
      });
      expect(result).toEqual({
        linkToken: "link-update-safe",
        expiration: "2026-08-12T19:00:00.000Z",
        affectedAccountIds: [accountId],
      });
      expect(JSON.stringify(result)).not.toContain(
        "access-decrypted-item-token",
      );
    },
  );

  it.each([
    [
      "update token",
      () =>
        createPlaidUpdateToken(actor, pendingItem.id, { reason: "consent" }),
    ],
    [
      "reconciliation",
      () => reconcilePlaidConnection(actor, pendingItem.id, {}),
    ],
    [
      "visibility",
      () =>
        changePlaidAccountVisibility(actor, pendingItem.id, {
          accountId,
          scope: "family",
          acknowledgeRetroactiveImpact: true,
        }),
    ],
    [
      "disconnect",
      () =>
        disconnectPlaidConnection(actor, pendingItem.id, {
          mode: "keep_history",
        }),
    ],
  ])(
    "rejects a pending Item before %s side effects",
    async (_operation, invoke) => {
      queueOwnedItem(pendingItem);

      await expect(invoke()).rejects.toMatchObject({
        status: 409,
        code: "connection_unavailable",
      });
      expect(provider.createUpdateLinkToken).not.toHaveBeenCalled();
      expect(provider.getAccounts).not.toHaveBeenCalled();
      expect(provider.removeItem).not.toHaveBeenCalled();
      expect(db.rpc).not.toHaveBeenCalled();
    },
  );

  it("API-007 sends fresh provider identities to the reconciliation RPC without stale substitution", async () => {
    queueOwnedItem();
    provider.getAccounts.mockResolvedValue([
      {
        accountId: "provider-fresh-id",
        name: "Fresh Savings",
        officialName: "Fresh Savings Account",
        mask: "7788",
        type: "depository",
        subtype: "savings",
        currencyCode: "CAD",
        availableBalanceCents: 25000,
        currentBalanceCents: 26000,
        creditLimitCents: null,
        balanceUpdatedAt: "2026-08-12T18:30:00.000Z",
      },
    ]);
    db.rpc.mockResolvedValue({
      data: { addedAccountIds: [], returnedAccountIds: [] },
      error: { code: "55000", message: "item disconnected" },
    });

    await expect(
      reconcilePlaidConnection(actor, itemId, {}),
    ).rejects.toMatchObject({
      code: "connection_unavailable",
    });
    expect(provider.getAccounts).toHaveBeenCalledExactlyOnceWith(
      "access-decrypted-item-token",
    );
    expect(db.rpc).toHaveBeenCalledWith(
      "reconcile_plaid_accounts",
      expect.objectContaining({
        p_item_id: itemId,
        p_accounts: [
          expect.objectContaining({ providerAccountId: "provider-fresh-id" }),
        ],
      }),
    );
  });

  it("API-009 rejects disconnect without recent confirmation before provider removal or finalization", async () => {
    queueOwnedItem();
    queue("recent_auth_confirmations", null);

    await expect(
      disconnectPlaidConnection(actor, itemId, { mode: "keep_history" }),
    ).rejects.toMatchObject({
      status: 403,
      code: "recent_confirmation_required",
    });
    expect(provider.removeItem).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("API-010 rejects a concurrent live disconnect claim before provider removal", async () => {
    queueOwnedItem();
    queue("recent_auth_confirmations", {
      confirmed_at: "2026-08-12T18:55:00.000Z",
    });
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "55P03", message: "disconnect in progress" },
    });

    await expect(
      disconnectPlaidConnection(actor, itemId, { mode: "keep_history" }),
    ).rejects.toMatchObject({ status: 409, code: "disconnect_in_progress" });
    expect(provider.removeItem).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith(
      "claim_plaid_disconnect",
      expect.objectContaining({
        p_item_id: itemId,
        p_mode: "keep_history",
        p_claim_id: expect.any(String),
      }),
    );
  });

  it("API-010 persists removal_started before invoking the provider and provider_removed before finalize", async () => {
    queueOwnedItem();
    queue("recent_auth_confirmations", {
      confirmed_at: "2026-08-12T18:55:00.000Z",
    });

    const result = await disconnectPlaidConnection(actor, itemId, {
      mode: "keep_history",
    });

    const claimCall = db.rpc.mock.calls.find(
      ([name]) => name === "claim_plaid_disconnect",
    );
    const claimId = claimCall?.[1]?.p_claim_id;
    const beginIndex = db.rpc.mock.calls.findIndex(
      ([name]) => name === "begin_plaid_disconnect_removal",
    );
    const markedIndex = db.rpc.mock.calls.findIndex(
      ([name]) => name === "mark_plaid_disconnect_provider_removed",
    );
    const finalizeIndex = db.rpc.mock.calls.findIndex(
      ([name]) => name === "finalize_claimed_plaid_disconnect",
    );
    expect(db.rpc.mock.calls[beginIndex]).toEqual([
      "begin_plaid_disconnect_removal",
      { p_item_id: itemId, p_claim_id: claimId },
    ]);
    expect(db.rpc.mock.invocationCallOrder[beginIndex]).toBeLessThan(
      provider.removeItem.mock.invocationCallOrder[0]!,
    );
    expect(provider.removeItem.mock.invocationCallOrder[0]).toBeLessThan(
      db.rpc.mock.invocationCallOrder[markedIndex]!,
    );
    expect(db.rpc.mock.invocationCallOrder[markedIndex]).toBeLessThan(
      db.rpc.mock.invocationCallOrder[finalizeIndex]!,
    );
    expect(db.rpc.mock.calls[markedIndex]).toEqual([
      "mark_plaid_disconnect_provider_removed",
      { p_item_id: itemId, p_claim_id: claimId },
    ]);
    expect(db.rpc.mock.calls[finalizeIndex]).toEqual([
      "finalize_claimed_plaid_disconnect",
      expect.objectContaining({ p_item_id: itemId, p_claim_id: claimId }),
    ]);
    expect(result).toEqual({
      itemId,
      mode: "keep_history",
      disconnected: true,
    });
  });

  it("API-013 provider failure after removal_started stays fail-closed and cannot finalize", async () => {
    queueOwnedItem();
    queue("recent_auth_confirmations", {
      confirmed_at: "2026-08-12T18:55:00.000Z",
    });
    provider.removeItem.mockRejectedValue(
      new Error("ambiguous network failure after request dispatch"),
    );

    await expect(
      disconnectPlaidConnection(actor, itemId, { mode: "keep_history" }),
    ).rejects.toMatchObject({ status: 502, code: "plaid_update_failed" });

    const names = db.rpc.mock.calls.map(([name]) => name);
    expect(names).toEqual([
      "claim_plaid_disconnect",
      "begin_plaid_disconnect_removal",
      "release_plaid_disconnect",
    ]);
    expect(names).not.toContain("mark_plaid_disconnect_provider_removed");
    expect(names).not.toContain("finalize_claimed_plaid_disconnect");
  });

  it("API-010 retry adopts durable provider_removed proof after finalize failure without removing twice", async () => {
    queueOwnedItem();
    queue("recent_auth_confirmations", {
      confirmed_at: "2026-08-12T18:55:00.000Z",
    });
    queueOwnedItem();
    queue("recent_auth_confirmations", {
      confirmed_at: "2026-08-12T18:56:00.000Z",
    });
    db.rpc
      .mockResolvedValueOnce({ data: "claimed", error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "XX000", message: "simulated local finalize failure" },
      })
      .mockResolvedValueOnce({ data: "provider_removed", error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    await expect(
      disconnectPlaidConnection(actor, itemId, { mode: "keep_history" }),
    ).rejects.toMatchObject({
      status: 502,
      code: "connection_management_failed",
    });
    expect(provider.removeItem).toHaveBeenCalledTimes(1);

    await expect(
      disconnectPlaidConnection(actor, itemId, { mode: "keep_history" }),
    ).resolves.toEqual({ itemId, mode: "keep_history", disconnected: true });

    expect(provider.removeItem).toHaveBeenCalledTimes(1);
    expect(
      db.rpc.mock.calls.filter(
        ([name]) => name === "begin_plaid_disconnect_removal",
      ),
    ).toHaveLength(1);
    expect(
      db.rpc.mock.calls.filter(
        ([name]) => name === "mark_plaid_disconnect_provider_removed",
      ),
    ).toHaveLength(1);
    expect(
      db.rpc.mock.calls.filter(
        ([name]) => name === "finalize_claimed_plaid_disconnect",
      ),
    ).toHaveLength(2);
  });
  it("API-014 returns idempotent success for an already revoked Item without a second provider removal", async () => {
    queueOwnedItem({
      ...activeItem,
      status: "revoked",
      disconnected_at: "2026-08-12T18:50:00.000Z",
    });

    await expect(
      disconnectPlaidConnection(actor, itemId, { mode: "keep_history" }),
    ).resolves.toEqual({ itemId, mode: "keep_history", disconnected: true });
    expect(provider.removeItem).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
