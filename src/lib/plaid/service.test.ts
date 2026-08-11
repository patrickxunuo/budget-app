import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  provider: {
    createLinkToken: vi.fn(),
    exchangePublicToken: vi.fn(),
    getInstitution: vi.fn(),
    getAccounts: vi.fn(),
    syncTransactions: vi.fn(),
  },
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
}));

class QueryBuilder implements PromiseLike<{ data: unknown; error: unknown }> {
  private action: "select" | "insert" | "delete" | "upsert" = "select";
  private payload: unknown;

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

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => admin,
}));

import type { PlaidApiActor } from "@/lib/auth/api";
import { decryptAccessToken, parseBytea } from "./crypto";
import {
  activatePlaidReview,
  createLinkTokenForMember,
  exchangePublicTokenForReview,
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
  mocks.transactionUpserts.length = 0;
  mocks.syncStateUpserts.length = 0;
  mocks.accountRows.length = 0;
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
  mocks.insertedItems.length = 0;
  mocks.insertedCandidates.length = 0;
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

  it("paginates sync, filters unselected accounts, and counts repeated provider ids idempotently", async () => {
    mocks.accountRows.push({
      id: "50000000-0000-4000-8000-000000000001",
      provider_account_id: "provider-chequing",
    });
    const repeated = {
      transactionId: "transaction-repeat",
      accountId: "provider-chequing",
      amount: 12.5,
      currencyCode: "CAD",
      authorizedDate: null,
      date: "2026-08-11",
      merchantName: "Market",
      name: "Market",
      pending: false,
      payload: {},
    };
    mocks.provider.syncTransactions
      .mockResolvedValueOnce({
        added: [
          repeated,
          {
            ...repeated,
            transactionId: "transaction-unselected",
            accountId: "other-account",
          },
        ],
        modified: [{ ...repeated, amount: 13 }],
        removedIds: [],
        nextCursor: "page-2",
        hasMore: true,
      })
      .mockResolvedValueOnce({
        added: [repeated, { ...repeated, transactionId: "transaction-second" }],
        modified: [],
        removedIds: [],
        nextCursor: "complete",
        hasMore: false,
      });

    const result = await activatePlaidReview(actor, {
      reviewId: "40000000-0000-4000-8000-000000000001",
      accounts: selectedAccounts,
    });

    expect(mocks.provider.syncTransactions).toHaveBeenNthCalledWith(
      1,
      "access-token-plaintext",
      undefined,
    );
    expect(mocks.provider.syncTransactions).toHaveBeenNthCalledWith(
      2,
      "access-token-plaintext",
      "page-2",
    );
    expect(
      mocks.transactionUpserts.flat().map((row) => row.plaid_transaction_id),
    ).toEqual([
      "transaction-repeat",
      "transaction-repeat",
      "transaction-second",
    ]);
    expect(mocks.transactionUpserts.flat()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          plaid_transaction_id: "transaction-unselected",
        }),
      ]),
    );
    expect(result).toMatchObject({
      importedTransactions: 2,
      importStatus: "complete",
    });
    expect(mocks.syncStateUpserts.at(-1)).toMatchObject({
      cursor: "complete",
      status: "succeeded",
      error_code: null,
      error_message: null,
    });
  });

  it("treats PRODUCT_NOT_READY as a successful pending import with sanitized state", async () => {
    mocks.provider.syncTransactions.mockRejectedValue(
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
    expect(mocks.syncStateUpserts.at(-1)).toMatchObject({
      status: "idle",
      error_code: null,
      error_message: null,
    });
    expect(JSON.stringify(mocks.syncStateUpserts.at(-1))).not.toMatch(
      /PRODUCT_NOT_READY|provider payload secret|access-token-plaintext/,
    );
  });

  it("keeps activation truthful when generic initial sync fails and records a sanitized retryable state", async () => {
    mocks.provider.syncTransactions.mockRejectedValue(
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
    expect(mocks.syncStateUpserts.at(-1)).toMatchObject({
      status: "failed",
      error_code: "initial_sync_failed",
    });
    expect(mocks.syncStateUpserts.at(-1)?.error_message).toMatch(/retry/i);
    expect(JSON.stringify(mocks.syncStateUpserts.at(-1))).not.toMatch(
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
