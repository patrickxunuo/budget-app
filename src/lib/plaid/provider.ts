import "server-only";

import { createHash, randomUUID } from "node:crypto";
import {
  CountryCode,
  Products,
  type AccountBase,
  type LinkTokenCreateRequest,
  type RemovedTransaction,
  type Transaction,
} from "plaid";

import { getServerEnv } from "@/lib/env/server";
import { getPlaidClient } from "@/lib/plaid/client";
import type {
  PlaidInstitution,
  ProviderAccount,
  ProviderTransaction,
} from "@/lib/plaid/types";

export type LinkTokenInput = {
  userId: string;
  webhookUrl: string;
  redirectUri: string;
};

export type SyncPage = {
  added: ProviderTransaction[];
  modified: ProviderTransaction[];
  removedIds: string[];
  nextCursor: string;
  hasMore: boolean;
  requestId: string;
};

export interface PlaidProvider {
  createLinkToken(
    input: LinkTokenInput,
  ): Promise<{ linkToken: string; expiration: string }>;
  exchangePublicToken(
    publicToken: string,
  ): Promise<{ accessToken: string; itemId: string }>;
  getInstitution(accessToken: string): Promise<PlaidInstitution>;
  getAccounts(accessToken: string): Promise<ProviderAccount[]>;
  syncTransactions(accessToken: string, cursor?: string): Promise<SyncPage>;
  getWebhookVerificationKey(
    keyId: string,
  ): Promise<import("@/lib/plaid/types").PlaidVerificationKey>;
}

function stableClientUserId(userId: string): string {
  return createHash("sha256").update(`budget-app:${userId}`).digest("hex");
}

function balanceCents(value: number | null | undefined): number | null {
  if (value == null) return null;
  const cents = Math.round(value * 100);
  if (
    !Number.isSafeInteger(cents) ||
    Math.abs(value * 100 - cents) > Number.EPSILON * 100
  )
    throw new RangeError("Plaid balance is outside safe CAD cents");
  return cents;
}

function normalizeAccount(account: AccountBase): ProviderAccount {
  return {
    accountId: account.account_id,
    name: account.name,
    officialName: account.official_name ?? null,
    mask: account.mask ?? null,
    type: account.type,
    subtype: account.subtype ?? null,
    currencyCode: account.balances.iso_currency_code ?? null,
    availableBalanceCents: balanceCents(account.balances.available),
    currentBalanceCents: balanceCents(account.balances.current),
    creditLimitCents: balanceCents(account.balances.limit),
    balanceUpdatedAt: new Date().toISOString(),
  };
}

function normalizeTransaction(transaction: Transaction): ProviderTransaction {
  return {
    transactionId: transaction.transaction_id,
    accountId: transaction.account_id,
    amount: transaction.amount,
    currencyCode: transaction.iso_currency_code ?? null,
    authorizedDate: transaction.authorized_date ?? null,
    date: transaction.date,
    merchantName: transaction.merchant_name ?? null,
    name: transaction.name,
    pending: transaction.pending,
    pendingTransactionId: transaction.pending_transaction_id ?? null,
    payload: {
      paymentChannel: transaction.payment_channel,
      personalFinanceCategory: transaction.personal_finance_category,
      stableMerchantId: transaction.merchant_entity_id ?? null,
    },
  };
}

class PlaidSdkProvider implements PlaidProvider {
  async createLinkToken(input: LinkTokenInput) {
    const request: LinkTokenCreateRequest = {
      client_name: "Budget App",
      country_codes: [CountryCode.Ca],
      language: "en",
      products: [Products.Transactions],
      transactions: { days_requested: 365 },
      webhook: input.webhookUrl,
      redirect_uri: input.redirectUri,
      user: { client_user_id: stableClientUserId(input.userId) },
    };
    const { data } = await getPlaidClient().linkTokenCreate(request);
    return { linkToken: data.link_token, expiration: data.expiration };
  }

  async exchangePublicToken(publicToken: string) {
    const { data } = await getPlaidClient().itemPublicTokenExchange({
      public_token: publicToken,
    });
    return {
      accessToken: data.access_token,
      itemId: data.item_id,
    };
  }

  async getInstitution(accessToken: string) {
    const client = getPlaidClient();
    const { data: itemData } = await client.itemGet({
      access_token: accessToken,
    });
    const institutionId = itemData.item.institution_id;
    if (!institutionId) {
      throw new Error("Plaid Item has no institution identity");
    }
    const { data: institutionData } = await client.institutionsGetById({
      institution_id: institutionId,
      country_codes: [CountryCode.Ca],
    });
    return {
      id: institutionId,
      name: institutionData.institution.name,
    };
  }

  async getAccounts(accessToken: string) {
    const { data } = await getPlaidClient().accountsGet({
      access_token: accessToken,
    });
    return data.accounts.map(normalizeAccount);
  }

  async syncTransactions(accessToken: string, cursor?: string) {
    const { data } = await getPlaidClient().transactionsSync({
      access_token: accessToken,
      cursor,
    });
    return {
      added: data.added.map(normalizeTransaction),
      modified: data.modified.map(normalizeTransaction),
      removedIds: data.removed.map(
        (item: RemovedTransaction) => item.transaction_id,
      ),
      nextCursor: data.next_cursor,
      hasMore: data.has_more,
      requestId: data.request_id,
    };
  }

  async getWebhookVerificationKey(keyId: string) {
    const { data } = await getPlaidClient().webhookVerificationKeyGet({
      key_id: keyId,
    });
    const key = data.key;
    return {
      alg: key.alg as "ES256",
      crv: key.crv as "P-256",
      expiredAt: key.expired_at ?? null,
      kid: key.kid,
      kty: key.kty as "EC",
      use: key.use as "sig",
      x: key.x,
      y: key.y,
    };
  }
}

const deterministicAt = new Date().toISOString();
const deterministicAccounts: ProviderAccount[] = [
  {
    accountId: "e2e-chequing",
    name: "Everyday Chequing",
    officialName: "Everyday Chequing Account",
    mask: "1204",
    type: "depository",
    subtype: "checking",
    currencyCode: "CAD",
    availableBalanceCents: 192500,
    currentBalanceCents: 200000,
    creditLimitCents: null,
    balanceUpdatedAt: deterministicAt,
  },
  {
    accountId: "e2e-savings",
    name: "Rainy Day Savings",
    officialName: "High Interest Savings",
    mask: "8421",
    type: "depository",
    subtype: "savings",
    currencyCode: "CAD",
    availableBalanceCents: 192500,
    currentBalanceCents: 200000,
    creditLimitCents: null,
    balanceUpdatedAt: deterministicAt,
  },
  {
    accountId: "e2e-usd",
    name: "US Dollar Account",
    officialName: null,
    mask: "9090",
    type: "depository",
    subtype: "checking",
    currencyCode: "USD",
    availableBalanceCents: null,
    currentBalanceCents: null,
    creditLimitCents: null,
    balanceUpdatedAt: deterministicAt,
  },
];

class DeterministicPlaidProvider implements PlaidProvider {
  async createLinkToken() {
    return {
      linkToken: "e2e-deterministic-link-token",
      expiration: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
  }

  async exchangePublicToken(publicToken: string) {
    if (publicToken === "e2e-public-expired") {
      throw Object.assign(new Error("expired"), {
        code: "INVALID_PUBLIC_TOKEN",
      });
    }
    if (publicToken !== "e2e-public-success") {
      throw new Error("invalid deterministic token");
    }
    const suffix = randomUUID();
    return {
      accessToken: `e2e-access-token-${suffix}`,
      itemId: `e2e-item-${suffix}`,
    };
  }

  async getInstitution() {
    return { id: "ins_e2e", name: "E2E Canadian Bank" };
  }

  async getAccounts(accessToken: string) {
    const suffix = accessToken.replace("e2e-access-token-", "");
    return deterministicAccounts.map((account) => ({
      ...account,
      accountId: `${account.accountId}-${suffix}`,
    }));
  }

  async syncTransactions(accessToken: string, cursor?: string) {
    if (!cursor) {
      return {
        added: [
          {
            transactionId: `e2e-transaction-${accessToken.replace("e2e-access-token-", "")}`,
            accountId: `e2e-chequing-${accessToken.replace("e2e-access-token-", "")}`,
            amount: 42.18,
            currencyCode: "CAD",
            authorizedDate: "2026-08-10",
            date: "2026-08-11",
            merchantName: "Northern Grocer",
            name: "Northern Grocer",
            pending: false,
            pendingTransactionId: null,
            payload: { paymentChannel: "in store" },
          },
        ],
        modified: [],
        removedIds: [],
        nextCursor: "e2e-complete",
        hasMore: false,
        requestId: "e2e-initial-request",
      };
    }
    return {
      added: [],
      modified: [],
      removedIds: [],
      nextCursor: cursor,
      hasMore: false,
      requestId: "e2e-idle-request",
    };
  }

  async getWebhookVerificationKey(): Promise<
    import("@/lib/plaid/types").PlaidVerificationKey
  > {
    throw new Error(
      "Webhook verification is unavailable in deterministic mode",
    );
  }
}

let provider: PlaidProvider | undefined;

export function getPlaidProvider(): PlaidProvider {
  if (provider) return provider;
  const env = getServerEnv();
  if (env.PLAID_E2E_PROVIDER === "deterministic") {
    const origin = new URL(env.APP_URL);
    if (
      env.PLAID_ENV !== "sandbox" ||
      !["localhost", "127.0.0.1", "::1"].includes(origin.hostname) ||
      process.env.NODE_ENV === "production" ||
      process.env.VERCEL_ENV === "production"
    ) {
      throw new Error(
        "Deterministic Plaid provider is restricted to local sandbox E2E runs",
      );
    }
    const deterministicProvider = new DeterministicPlaidProvider();
    provider = deterministicProvider;
    return deterministicProvider;
  }
  provider = new PlaidSdkProvider();
  return provider;
}
