import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  provider: {
    createLinkToken: vi.fn(),
    exchangePublicToken: vi.fn(),
    getInstitution: vi.fn(),
    getAccounts: vi.fn(),
    syncTransactions: vi.fn(),
    removeItem: vi.fn(),
  },
  syncPlaidItem: vi.fn(),
  rpc: vi.fn(),
  insertedItems: [] as Record<string, unknown>[],
  insertedCandidates: [] as Record<string, unknown>[],
  transactionUpserts: [] as Record<string, unknown>[][],
  syncStateUpserts: [] as Record<string, unknown>[],
  duplicateResult: {
    data: [] as Record<string, unknown>[],
    error: null as unknown,
  },
  itemCiphertext: "" as string,
  accountRows: [] as Record<string, unknown>[],
  lifecycleRows: [] as Record<string, unknown>[],
  lifecycleRanges: [] as Array<[number, number]>,
  lifecycleOrders: [] as Array<{ column: string; ascending?: boolean }>,
}));

class QueryBuilder implements PromiseLike<{ data: unknown; error: unknown }> {
  private action: "select" | "insert" | "delete" | "upsert" = "select";
  private payload: unknown;
  private rangeStart: number | null = null;
  private rangeEnd: number | null = null;

  constructor(private readonly table: string) {}

  select() {
    return this;
  }

  insert(payload: unknown) {
    this.action = "insert";
    this.payload = payload;
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  upsert(payload: unknown) {
    this.action = "upsert";
    this.payload = payload;
    return this;
  }

  eq() {
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    mocks.lifecycleOrders.push({ column, ascending: options?.ascending });
    return this;
  }

  range(from: number, to: number) {
    this.rangeStart = from;
    this.rangeEnd = to;
    mocks.lifecycleRanges.push([from, to]);
    return this;
  }

  is() {
    return this;
  }

  in() {
    return this;
  }

  single() {
    return Promise.resolve(this.result());
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: unknown;
          error: unknown;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected);
  }

  private result(): { data: unknown; error: unknown } {
    if (this.table === "plaid_items" && this.action === "insert") {
      const row = this.payload as Record<string, unknown>;
      mocks.insertedItems.push(row);
      mocks.itemCiphertext = row.access_token_ciphertext as string;
      return {
        data: { id: "40000000-0000-4000-8000-000000000001" },
        error: null,
      };
    }
    if (this.table === "plaid_items" && this.action === "select") {
      if (this.rangeStart !== null && this.rangeEnd !== null) {
        return {
          data: mocks.lifecycleRows.slice(this.rangeStart, this.rangeEnd + 1),
          error: null,
        };
      }
      return {
        data: { access_token_ciphertext: mocks.itemCiphertext },
        error: null,
      };
    }
    if (this.table === "plaid_pending_accounts" && this.action === "insert") {
      mocks.insertedCandidates.push(
        ...((this.payload as Record<string, unknown>[]) ?? []),
      );
      return { data: null, error: null };
    }
    if (this.table === "accounts" && this.action === "select") {
      if (mocks.accountRows.length) {
        return { data: mocks.accountRows, error: null };
      }
      return mocks.duplicateResult;
    }
    if (this.table === "transactions" && this.action === "upsert") {
      mocks.transactionUpserts.push(this.payload as Record<string, unknown>[]);
      return { data: null, error: null };
    }
    if (this.table === "sync_state" && this.action === "upsert") {
      mocks.syncStateUpserts.push(this.payload as Record<string, unknown>);
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }
}

const admin = {
  from: vi.fn((table: string) => new QueryBuilder(table)),
  rpc: mocks.rpc,
};

vi.mock("@/lib/env/server", () => ({
  getServerEnv: () => ({
    APP_URL: "https://budget.example.test",
    PLAID_WEBHOOK_URL: "https://budget.example.test/api/plaid/webhook",
    PLAID_TOKEN_ENCRYPTION_KEY: "test-key-material-that-is-long-enough",
  }),
}));

vi.mock("@/lib/plaid/provider", () => ({
  getPlaidProvider: () => mocks.provider,
}));

vi.mock("@/lib/plaid/sync-service", () => ({
  syncPlaidItem: mocks.syncPlaidItem,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => admin,
}));

import type { PlaidApiActor } from "@/lib/auth/api";
import { decryptAccessToken, parseBytea } from "./crypto";
import {
  activatePlaidReview,
  createLinkTokenForMember,
  exchangePublicTokenForReview,
  oauthRedirectUri,
  revokePlaidItemsForDeletion,
} from "./service";

const actor: PlaidApiActor = {
  userId: "10000000-0000-0000-0000-000000000001",
  workspaceId: "20000000-0000-0000-0000-000000000001",
  membershipId: "30000000-0000-0000-0000-000000000001",
};

const eligibleChequing = {
  accountId: "provider-chequing",
  name: "Everyday Chequing",
  officialName: "Everyday Chequing Account",
  mask: "1204",
  type: "depository",
  subtype: "checking",
  currencyCode: "CAD",
};

const selectedAccount = {
  providerAccountId: "provider-chequing",
  scope: "personal" as const,
};

const selectedAccounts = [selectedAccount];

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.insertedItems.length = 0;
  mocks.insertedCandidates.length = 0;
  mocks.syncPlaidItem.mockResolvedValue({
    itemId: "40000000-0000-4000-8000-000000000001",
    status: "succeeded",
    added: 2,
    modified: 0,
    removed: 0,
    requestId: "provider-request",
    lastSuccessAt: "2026-08-11T22:00:00.000Z",
  });
  mocks.transactionUpserts.length = 0;
  mocks.syncStateUpserts.length = 0;
  mocks.accountRows.length = 0;
  mocks.lifecycleRows.length = 0;
  mocks.lifecycleRanges.length = 0;
  mocks.lifecycleOrders.length = 0;
  mocks.duplicateResult = { data: [], error: null };

  mocks.provider.createLinkToken.mockResolvedValue({
    linkToken: "link-ca-transactions",
    expiration: "2026-08-12T00:00:00.000Z",
  });
  mocks.provider.exchangePublicToken.mockResolvedValue({
    accessToken: "access-token-plaintext",
    itemId: "provider-item-1",
  });
  mocks.provider.getInstitution.mockResolvedValue({
    id: "ins-provider-ca",
    name: "Provider Canonical Bank",
  });
  mocks.provider.getAccounts.mockResolvedValue([eligibleChequing]);
  mocks.provider.syncTransactions.mockResolvedValue({
    added: [],
    modified: [],
    removedIds: [],
    nextCursor: "done",
    hasMore: false,
  });
  mocks.rpc.mockResolvedValue({
    data: {
      itemId: "40000000-0000-4000-8000-000000000001",
      activatedAccountIds: ["50000000-0000-4000-8000-000000000001"],
    },
    error: null,
  });

  // Seed a real encrypted payload by exercising the exchange boundary. Tests
  // which focus on activation can decrypt it through the production helper.
  await exchangePublicTokenForReview(actor, {
    publicToken: "public-token-once",
    institution: { id: "ins-ca", name: "Canadian Test Bank" },
  });
  vi.clearAllMocks();
  mocks.provider.removeItem.mockResolvedValue(undefined);
  mocks.insertedItems.length = 0;
  mocks.insertedCandidates.length = 0;
});

describe("OAuth redirect URI", () => {
  it("returns the /accounts return URL for a registrable HTTPS origin", () => {
    expect(oauthRedirectUri("https://budget.example.test")).toBe(
      "https://budget.example.test/accounts",
    );
  });

  it("omits the redirect URI for local HTTP origins Plaid cannot register", () => {
    expect(oauthRedirectUri("http://127.0.0.1:3100")).toBeNull();
    expect(oauthRedirectUri("http://localhost:3000")).toBeNull();
  });
});

describe("Plaid linking service", () => {
  it("creates a token with the authenticated member, configured webhook, and /accounts OAuth return", async () => {
    const result = await createLinkTokenForMember(actor);

    expect(result).toEqual({
      linkToken: "link-ca-transactions",
      expiration: "2026-08-12T00:00:00.000Z",
    });
    expect(mocks.provider.createLinkToken).toHaveBeenCalledExactlyOnceWith({
      userId: actor.userId,
      webhookUrl: "https://budget.example.test/api/plaid/webhook",
      redirectUri: "https://budget.example.test/accounts",
    });
  });

  it("encrypts the exchanged access token and persists every eligible and ineligible account for review", async () => {
    mocks.provider.getAccounts.mockResolvedValue([
      eligibleChequing,
      {
        ...eligibleChequing,
        accountId: "provider-usd",
        name: "US Dollar Account",
        currencyCode: "USD",
      },
      {
        ...eligibleChequing,
        accountId: "provider-loan",
        name: "Vehicle Loan",
        type: "loan",
        subtype: "auto",
      },
    ]);

    const result = await exchangePublicTokenForReview(actor, {
      publicToken: "public-token-once",
      institution: { id: "ins-ca", name: "Canadian Test Bank" },
    });

    expect(result.accounts).toHaveLength(3);
    expect(
      result.accounts.map(({ providerAccountId, eligible }) => ({
        providerAccountId,
        eligible,
      })),
    ).toEqual([
      { providerAccountId: "provider-chequing", eligible: true },
      { providerAccountId: "provider-usd", eligible: false },
      { providerAccountId: "provider-loan", eligible: false },
    ]);
    expect(mocks.insertedCandidates).toHaveLength(3);
    expect(
      mocks.insertedCandidates.map((row) => row.provider_account_id),
    ).toEqual(["provider-chequing", "provider-usd", "provider-loan"]);

    const persisted = mocks.insertedItems[0];
    expect(persisted).toBeDefined();
    if (!persisted) throw new Error("Plaid Item was not persisted");
    expect(persisted.status).toBe("pending");
    expect(persisted.access_token_ciphertext).not.toContain(
      "access-token-plaintext",
    );
    expect(JSON.stringify(persisted)).not.toContain("public-token-once");
    expect(
      decryptAccessToken(
        parseBytea(persisted.access_token_ciphertext as string),
        "test-key-material-that-is-long-enough",
      ),
    ).toBe("access-token-plaintext");
    expect(result).not.toHaveProperty("accessToken");
  });

  it("ignores fabricated browser institution metadata and persists only the provider-authenticated identity", async () => {
    const result = await exchangePublicTokenForReview(actor, {
      publicToken: "public-token-once",
      institution: {
        id: "ins-attacker-fabricated",
        name: "Attacker Controlled Bank Name",
      },
    });

    expect(mocks.provider.getInstitution).toHaveBeenCalledExactlyOnceWith(
      "access-token-plaintext",
    );
    expect(result.institution).toEqual({
      id: "ins-provider-ca",
      name: "Provider Canonical Bank",
    });
    expect(mocks.insertedItems.at(-1)).toMatchObject({
      institution_id: "ins-provider-ca",
      institution_name: "Provider Canonical Bank",
    });
    expect(JSON.stringify(result)).not.toMatch(
      /ins-attacker-fabricated|Attacker Controlled Bank Name/,
    );
    expect(JSON.stringify(mocks.insertedItems)).not.toMatch(
      /ins-attacker-fabricated|Attacker Controlled Bank Name/,
    );
  });
  it("fails exchange safely when the Family duplicate lookup fails instead of suppressing the database error", async () => {
    mocks.duplicateResult = {
      data: [],
      error: { code: "XX000", message: "database detail must stay private" },
    };

    await expect(
      exchangePublicTokenForReview(actor, {
        publicToken: "public-token-once",
        institution: { id: "ins-ca", name: "Canadian Test Bank" },
      }),
    ).rejects.toMatchObject({
      status: 502,
      code: "plaid_exchange_failed",
    });
    expect(mocks.insertedCandidates).toHaveLength(0);
  });

  it("delegates initial import to the shared atomic sync path", async () => {
    const result = await activatePlaidReview(actor, {
      reviewId: "40000000-0000-4000-8000-000000000001",
      accounts: selectedAccounts,
    });

    expect(mocks.syncPlaidItem).toHaveBeenCalledExactlyOnceWith(
      "40000000-0000-4000-8000-000000000001",
      "activation",
      actor,
    );
    expect(result).toMatchObject({
      importedTransactions: 2,
      importStatus: "complete",
    });
  });

  it("treats PRODUCT_NOT_READY as a successful pending import with sanitized state", async () => {
    mocks.syncPlaidItem.mockRejectedValue(
      Object.assign(new Error("provider payload secret"), {
        response: { data: { error_code: "PRODUCT_NOT_READY" } },
      }),
    );

    const result = await activatePlaidReview(actor, {
      reviewId: "40000000-0000-4000-8000-000000000001",
      accounts: selectedAccounts,
    });

    expect(result).toMatchObject({
      importedTransactions: 0,
      importStatus: "pending",
    });
    expect(JSON.stringify(result)).not.toMatch(
      /PRODUCT_NOT_READY|provider payload secret|access-token-plaintext/,
    );
  });

  it("keeps activation truthful when generic initial sync fails and records a sanitized retryable state", async () => {
    mocks.syncPlaidItem.mockRejectedValue(
      Object.assign(new Error("access-token-plaintext socket failure"), {
        response: {
          data: {
            error_code: "INTERNAL_SERVER_ERROR",
            request_id: "secret-request",
          },
        },
      }),
    );

    const result = await activatePlaidReview(actor, {
      reviewId: "40000000-0000-4000-8000-000000000001",
      accounts: selectedAccounts,
    });

    expect(result).toMatchObject({
      importedTransactions: 0,
      importStatus: "pending",
    });
    expect(JSON.stringify(result)).not.toMatch(
      /access-token-plaintext|INTERNAL_SERVER_ERROR|secret-request|socket failure/,
    );
  });

  it("rejects duplicate submitted account ids before the activation transaction", async () => {
    await expect(
      activatePlaidReview(actor, {
        reviewId: "40000000-0000-4000-8000-000000000001",
        accounts: [selectedAccount, selectedAccount],
      }),
    ).rejects.toMatchObject({ status: 400, code: "duplicate_selection" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("GH-12 durable lifecycle Plaid revocation", () => {
  const lifecycleItem = (index: number, status = "revoked") => ({
    id: `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    access_token_ciphertext: mocks.itemCiphertext,
    linked_by: actor.userId,
    status,
  });

  it("API-010 reads every stable page and runs claim -> begin -> provider_removed -> finalize before confirming an active Item", async () => {
    mocks.lifecycleRows.push(
      ...Array.from({ length: 1000 }, (_, index) => lifecycleItem(index + 1)),
      lifecycleItem(1001, "active"),
    );
    mocks.rpc
      .mockResolvedValueOnce({ data: "claimed", error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    const result = await revokePlaidItemsForDeletion(actor.workspaceId);

    expect(mocks.lifecycleOrders).toContainEqual({
      column: "id",
      ascending: true,
    });
    expect(mocks.lifecycleRanges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(result.confirmedItemIds).toHaveLength(1001);
    expect(result.unresolvedItemIds).toEqual([]);
    const names = mocks.rpc.mock.calls.map(([name]) => name);
    expect(names).toEqual([
      "claim_plaid_disconnect",
      "begin_plaid_disconnect_removal",
      "mark_plaid_disconnect_provider_removed",
      "finalize_claimed_plaid_disconnect",
    ]);
    const claimId = mocks.rpc.mock.calls[0]?.[1]?.p_claim_id;
    expect(mocks.rpc.mock.calls[0]).toEqual([
      "claim_plaid_disconnect",
      expect.objectContaining({
        p_item_id: lifecycleItem(1001, "active").id,
        p_workspace_id: actor.workspaceId,
        p_profile_id: actor.userId,
        p_claim_id: expect.any(String),
        p_mode: "keep_history",
      }),
    ]);
    expect(mocks.rpc.mock.calls[1]).toEqual([
      "begin_plaid_disconnect_removal",
      { p_item_id: lifecycleItem(1001, "active").id, p_claim_id: claimId },
    ]);
    expect(mocks.rpc.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.provider.removeItem.mock.invocationCallOrder[0]!,
    );
    expect(mocks.provider.removeItem.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[2]!,
    );
    expect(mocks.rpc.mock.calls[2]).toEqual([
      "mark_plaid_disconnect_provider_removed",
      { p_item_id: lifecycleItem(1001, "active").id, p_claim_id: claimId },
    ]);
    expect(mocks.rpc.mock.calls[3]).toEqual([
      "finalize_claimed_plaid_disconnect",
      expect.objectContaining({
        p_item_id: lifecycleItem(1001, "active").id,
        p_claim_id: claimId,
        p_mode: "keep_history",
      }),
    ]);
  });

  it("API-011 fails a concurrent claim closed without provider removal or destructive finalization", async () => {
    const item = lifecycleItem(2001, "active");
    mocks.lifecycleRows.push(item);
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "55P03", message: "disconnect in progress" },
    });

    await expect(
      revokePlaidItemsForDeletion(actor.workspaceId),
    ).resolves.toEqual({
      confirmedItemIds: [],
      unresolvedItemIds: [item.id],
    });

    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "claim_plaid_disconnect",
      expect.objectContaining({ p_item_id: item.id }),
    );
    expect(mocks.provider.removeItem).not.toHaveBeenCalled();
    expect(
      mocks.rpc.mock.calls.some(
        ([name]) => name === "finalize_claimed_plaid_disconnect",
      ),
    ).toBe(false);
  });

  it("API-008 adopts durable provider_removed proof and finalizes without an unnecessary second provider call", async () => {
    const item = lifecycleItem(3001, "active");
    mocks.lifecycleRows.push(item);
    mocks.rpc
      .mockResolvedValueOnce({ data: "provider_removed", error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    await expect(
      revokePlaidItemsForDeletion(actor.workspaceId),
    ).resolves.toEqual({
      confirmedItemIds: [item.id],
      unresolvedItemIds: [],
    });

    expect(mocks.provider.removeItem).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_plaid_disconnect",
      "finalize_claimed_plaid_disconnect",
    ]);
    expect(mocks.rpc.mock.calls[1]).toEqual([
      "finalize_claimed_plaid_disconnect",
      expect.objectContaining({
        p_item_id: item.id,
        p_mode: "keep_history",
      }),
    ]);
  });
});
