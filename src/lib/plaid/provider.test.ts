import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  linkTokenCreate: vi.fn(),
  itemPublicTokenExchange: vi.fn(),
  itemGet: vi.fn(),
  institutionsGetById: vi.fn(),
  accountsGet: vi.fn(),
  transactionsSync: vi.fn(),
}));

vi.mock("@/lib/env/server", () => ({
  getServerEnv: () => ({
    APP_URL: "https://budget.example.test",
    PLAID_ENV: "sandbox",
  }),
}));

vi.mock("@/lib/plaid/client", () => ({
  getPlaidClient: () => mocks,
}));

import { getPlaidProvider } from "./provider";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.linkTokenCreate.mockResolvedValue({
    data: {
      link_token: "link-token-ca",
      expiration: "2026-08-12T00:00:00.000Z",
    },
  });
  mocks.itemGet.mockResolvedValue({
    data: { item: { institution_id: "ins_provider_ca" } },
  });
  mocks.institutionsGetById.mockResolvedValue({
    data: {
      institution: {
        institution_id: "ins_provider_ca",
        name: "Provider Canonical Bank",
      },
    },
  });
});

describe("Plaid SDK provider", () => {
  it("constructs the exact read-only Canadian Transactions Link request", async () => {
    const provider = getPlaidProvider();
    const userId = "10000000-0000-4000-8000-000000000001";

    await provider.createLinkToken({
      userId,
      webhookUrl: "https://budget.example.test/api/plaid/webhook",
      redirectUri: "https://budget.example.test/accounts",
    });

    expect(mocks.linkTokenCreate).toHaveBeenCalledExactlyOnceWith({
      client_name: "Budget App",
      country_codes: ["CA"],
      language: "en",
      products: ["transactions"],
      transactions: { days_requested: 365 },
      webhook: "https://budget.example.test/api/plaid/webhook",
      redirect_uri: "https://budget.example.test/accounts",
      user: {
        client_user_id: createHash("sha256")
          .update(`budget-app:${userId}`)
          .digest("hex"),
      },
    });

    const request = mocks.linkTokenCreate.mock.calls[0]?.[0];
    expect(request.products).toEqual(["transactions"]);
    expect(JSON.stringify(request)).not.toMatch(
      /auth|transfer|signal|payment.initiation|identity/i,
    );
  });

  it("omits redirect_uri entirely when no registrable origin is configured", async () => {
    const provider = getPlaidProvider();

    await provider.createLinkToken({
      userId: "10000000-0000-4000-8000-000000000001",
      webhookUrl: "https://budget.example.test/api/plaid/webhook",
      redirectUri: null,
    });

    const request = mocks.linkTokenCreate.mock.calls[0]?.[0];
    expect(request).not.toHaveProperty("redirect_uri");
  });

  it("derives canonical institution id and name from the exchanged access token", async () => {
    const provider = getPlaidProvider();

    const institution = await provider.getInstitution("access-provider-secret");

    expect(mocks.itemGet).toHaveBeenCalledExactlyOnceWith({
      access_token: "access-provider-secret",
    });
    expect(mocks.institutionsGetById).toHaveBeenCalledExactlyOnceWith({
      institution_id: "ins_provider_ca",
      country_codes: ["CA"],
    });
    expect(institution).toEqual({
      id: "ins_provider_ca",
      name: "Provider Canonical Bank",
    });
  });

  it("converts ordinary two-decimal balances whose binary residue exceeds an absolute epsilon", async () => {
    mocks.accountsGet.mockResolvedValue({
      data: {
        accounts: [
          {
            account_id: "provider-chequing",
            name: "Everyday Chequing",
            official_name: null,
            mask: "1204",
            type: "depository",
            subtype: "checking",
            balances: {
              available: 4523.19,
              current: 76543.21,
              limit: null,
              iso_currency_code: "CAD",
            },
          },
        ],
      },
    });

    const [account] = await getPlaidProvider().getAccounts("access-token");

    expect(account?.availableBalanceCents).toBe(452319);
    expect(account?.currentBalanceCents).toBe(7654321);
  });

  it("keeps an Item linkable when one account reports sub-cent precision", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.accountsGet.mockResolvedValue({
      data: {
        accounts: [
          {
            account_id: "provider-rrsp",
            name: "Plaid RRSP",
            official_name: null,
            mask: "8888",
            type: "investment",
            subtype: "rrsp",
            // Plaid reports four decimals on investment accounts. Throwing here
            // aborted the entire exchange, even though this account is not
            // eligible to link.
            balances: {
              available: null,
              current: 23631.9805,
              limit: null,
              iso_currency_code: "CAD",
            },
          },
        ],
      },
    });

    const [account] = await getPlaidProvider().getAccounts("access-token");

    expect(account?.currentBalanceCents).toBeNull();
    expect(account?.accountId).toBe("provider-rrsp");
    expect(warn).toHaveBeenCalledWith(
      "Plaid balance is not representable in CAD cents",
      { decimalPlaces: 4 },
    );
    warn.mockRestore();
  });
});
