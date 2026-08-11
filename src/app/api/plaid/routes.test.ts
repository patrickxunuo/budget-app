import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

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
  return {
    ApiAuthError,
    requirePlaidApiActor: vi.fn(),
  };
});

vi.mock("@/lib/plaid/service", () => ({
  createLinkTokenForMember: vi.fn(),
  exchangePublicTokenForReview: vi.fn(),
  activatePlaidReview: vi.fn(),
}));

import {
  ApiAuthError,
  requirePlaidApiActor,
  type PlaidApiActor,
} from "@/lib/auth/api";
import { PlaidFlowError } from "@/lib/plaid/errors";
import {
  activatePlaidReview,
  createLinkTokenForMember,
  exchangePublicTokenForReview,
} from "@/lib/plaid/service";
import { POST as activate } from "./activate/route";
import { POST as exchange } from "./exchange/route";
import { POST as linkToken } from "./link-token/route";

const actor: PlaidApiActor = {
  userId: "10000000-0000-0000-0000-000000000001",
  workspaceId: "20000000-0000-0000-0000-000000000001",
  membershipId: "30000000-0000-0000-0000-000000000001",
};

const institution = { id: "ins_ca_1", name: "Canadian Test Bank" };
const eligibleAccount = {
  providerAccountId: "provider-chequing",
  name: "Everyday Chequing",
  officialName: "Everyday Chequing Account",
  mask: "1204",
  type: "depository",
  subtype: "checking",
  currencyCode: "CAD",
  eligible: true,
  eligibilityMessage: null,
  defaultScope: "personal" as const,
  duplicate: null,
};
const ineligibleAccount = {
  ...eligibleAccount,
  providerAccountId: "provider-usd",
  name: "US Dollar Account",
  currencyCode: "USD",
  eligible: false,
  eligibilityMessage:
    "Only Canadian-dollar accounts can be connected right now.",
};

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlaidApiActor).mockResolvedValue(actor);
});

describe("GH-4 Plaid route acceptance", () => {
  it("API-001 active member receives a sanitized CA Transactions Link-token result", async () => {
    vi.mocked(createLinkTokenForMember).mockResolvedValue({
      linkToken: "link-sandbox-ca",
      expiration: "2026-08-11T23:59:00.000Z",
    });

    const response = await linkToken();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      linkToken: "link-sandbox-ca",
      expiration: "2026-08-11T23:59:00.000Z",
    });
    expect(createLinkTokenForMember).toHaveBeenCalledExactlyOnceWith(actor);
  });

  it("API-002 anonymous and inactive members are rejected before Plaid is called", async () => {
    vi.mocked(requirePlaidApiActor)
      .mockRejectedValueOnce(
        new ApiAuthError(
          401,
          "unauthorized",
          "Sign in again to connect a bank.",
        ),
      )
      .mockRejectedValueOnce(
        new ApiAuthError(
          403,
          "inactive_membership",
          "An active family membership is required to connect accounts.",
        ),
      );

    const anonymous = await linkToken();
    const inactive = await linkToken();

    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({
      code: "unauthorized",
      message: "Sign in again to connect a bank.",
    });
    expect(inactive.status).toBe(403);
    expect(await inactive.json()).toMatchObject({
      code: "inactive_membership",
    });
    expect(createLinkTokenForMember).not.toHaveBeenCalled();
  });

  it("API-003 Link-token provider failures return stable sanitized 502 errors", async () => {
    vi.mocked(createLinkTokenForMember).mockRejectedValue(
      new PlaidFlowError(
        502,
        "plaid_link_failed",
        "Plaid could not start a secure connection. Please try again.",
      ),
    );

    const response = await linkToken();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      code: "plaid_link_failed",
      message: "Plaid could not start a secure connection. Please try again.",
    });
    expect(JSON.stringify(body)).not.toMatch(/client.?secret|access.?token/i);
  });

  it("API-004 valid exchange returns every review account without an access token", async () => {
    vi.mocked(exchangePublicTokenForReview).mockResolvedValue({
      reviewId: "40000000-0000-0000-0000-000000000001",
      institution,
      accounts: [eligibleAccount, ineligibleAccount],
    });

    const response = await exchange(
      jsonRequest("/api/plaid/exchange", {
        publicToken: "public-sandbox-once",
        institution,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accounts).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain("public-sandbox-once");
    expect(JSON.stringify(body)).not.toMatch(/accessToken|ciphertext/i);
  });

  it("API-005 unsupported or non-CAD accounts remain visible and ineligible in review", async () => {
    vi.mocked(exchangePublicTokenForReview).mockResolvedValue({
      reviewId: "40000000-0000-0000-0000-000000000001",
      institution,
      accounts: [eligibleAccount, ineligibleAccount],
    });

    const response = await exchange(
      jsonRequest("/api/plaid/exchange", {
        publicToken: "public-sandbox-once",
        institution,
      }),
    );
    const body = await response.json();

    expect(body.accounts[1]).toMatchObject({
      providerAccountId: "provider-usd",
      eligible: false,
      defaultScope: "personal",
    });
    expect(body.accounts[1].eligibilityMessage).toMatch(/Canadian-dollar/i);
  });

  it("API-006 invalid public tokens and duplicate Items return stable 422 or 409 responses", async () => {
    vi.mocked(exchangePublicTokenForReview)
      .mockRejectedValueOnce(
        new PlaidFlowError(
          422,
          "invalid_public_token",
          "That bank connection expired. Start a new connection.",
        ),
      )
      .mockRejectedValueOnce(
        new PlaidFlowError(
          409,
          "item_already_linked",
          "This bank connection is already linked.",
        ),
      );

    const requestBody = { publicToken: "never-echo-me", institution };
    const expired = await exchange(
      jsonRequest("/api/plaid/exchange", requestBody),
    );
    const duplicate = await exchange(
      jsonRequest("/api/plaid/exchange", requestBody),
    );

    expect([expired.status, duplicate.status]).toEqual([422, 409]);
    expect(await expired.json()).toMatchObject({
      code: "invalid_public_token",
    });
    expect(await duplicate.json()).toMatchObject({
      code: "item_already_linked",
    });
  });

  it("API-007 mixed Personal and Family activation is passed atomically and returns activated ids", async () => {
    const selection = {
      reviewId: "40000000-0000-0000-0000-000000000001",
      accounts: [
        { providerAccountId: "provider-chequing", scope: "personal" as const },
        { providerAccountId: "provider-savings", scope: "family" as const },
      ],
    };
    vi.mocked(activatePlaidReview).mockResolvedValue({
      itemId: "50000000-0000-0000-0000-000000000001",
      activatedAccountIds: [
        "60000000-0000-0000-0000-000000000001",
        "60000000-0000-0000-0000-000000000002",
      ],
      importedTransactions: 2,
      importStatus: "complete",
    });

    const response = await activate(
      jsonRequest("/api/plaid/activate", selection),
    );

    expect(response.status).toBe(200);
    expect(activatePlaidReview).toHaveBeenCalledExactlyOnceWith(
      actor,
      selection,
    );
    expect(await response.json()).toMatchObject({
      activatedAccountIds: expect.arrayContaining([
        "60000000-0000-0000-0000-000000000001",
        "60000000-0000-0000-0000-000000000002",
      ]),
      importStatus: "complete",
    });
  });

  it("API-008 a Family duplicate without override returns 409 and no partial success payload", async () => {
    vi.mocked(activatePlaidReview).mockRejectedValue(
      new PlaidFlowError(
        409,
        "duplicate_account",
        "This looks like an existing Family account. Confirm the duplicate to continue.",
      ),
    );

    const response = await activate(
      jsonRequest("/api/plaid/activate", {
        reviewId: "40000000-0000-0000-0000-000000000001",
        accounts: [{ providerAccountId: "provider-chequing", scope: "family" }],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ code: "duplicate_account" });
    expect(body).not.toHaveProperty("activatedAccountIds");
  });

  it("API-009 an explicit Family duplicate override is preserved for audited activation", async () => {
    const selection = {
      reviewId: "40000000-0000-0000-0000-000000000001",
      accounts: [
        {
          providerAccountId: "provider-chequing",
          scope: "family" as const,
          acceptDuplicate: true,
        },
      ],
    };
    vi.mocked(activatePlaidReview).mockResolvedValue({
      itemId: "50000000-0000-0000-0000-000000000001",
      activatedAccountIds: ["60000000-0000-0000-0000-000000000001"],
      importedTransactions: 1,
      importStatus: "complete",
    });

    const response = await activate(
      jsonRequest("/api/plaid/activate", selection),
    );

    expect(response.status).toBe(200);
    expect(activatePlaidReview).toHaveBeenCalledExactlyOnceWith(
      actor,
      selection,
    );
  });

  it("API-010 invalid, foreign, duplicate, empty, and expired selections return stable errors without partial activation", async () => {
    for (const failure of [
      new PlaidFlowError(
        400,
        "invalid_selection",
        "Select an eligible account.",
      ),
      new PlaidFlowError(
        403,
        "forbidden",
        "This review belongs to another member.",
      ),
      new PlaidFlowError(
        400,
        "duplicate_selection",
        "Each account can be selected only once.",
      ),
      new PlaidFlowError(
        400,
        "invalid_selection",
        "Select at least one eligible account.",
        {
          accounts: ["Array must contain at least 1 element(s)"],
        },
      ),
      new PlaidFlowError(
        410,
        "review_expired",
        "This review expired. Reconnect your bank.",
      ),
    ]) {
      vi.mocked(activatePlaidReview).mockRejectedValueOnce(failure);
      const response = await activate(
        jsonRequest("/api/plaid/activate", {
          reviewId: "40000000-0000-0000-0000-000000000001",
          accounts: [],
        }),
      );
      const body = await response.json();
      expect(response.status).toBe(failure.status);
      expect(body.code).toBe(failure.code);
      expect(body).not.toHaveProperty("activatedAccountIds");
    }
  });

  it("API-011 paginated idempotent import reports only the selected-account transaction count", async () => {
    vi.mocked(activatePlaidReview).mockResolvedValue({
      itemId: "50000000-0000-0000-0000-000000000001",
      activatedAccountIds: ["60000000-0000-0000-0000-000000000001"],
      importedTransactions: 3,
      importStatus: "complete",
    });

    const response = await activate(
      jsonRequest("/api/plaid/activate", {
        reviewId: "40000000-0000-0000-0000-000000000001",
        accounts: [
          { providerAccountId: "provider-chequing", scope: "personal" },
        ],
      }),
    );

    expect(await response.json()).toMatchObject({
      importedTransactions: 3,
      importStatus: "complete",
    });
  });

  it("API-012 PRODUCT_NOT_READY remains a successful pending import with sanitized state", async () => {
    vi.mocked(activatePlaidReview).mockResolvedValue({
      itemId: "50000000-0000-0000-0000-000000000001",
      activatedAccountIds: ["60000000-0000-0000-0000-000000000001"],
      importedTransactions: 0,
      importStatus: "pending",
    });

    const response = await activate(
      jsonRequest("/api/plaid/activate", {
        reviewId: "40000000-0000-0000-0000-000000000001",
        accounts: [
          { providerAccountId: "provider-chequing", scope: "personal" },
        ],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      importedTransactions: 0,
      importStatus: "pending",
    });
    expect(JSON.stringify(body)).not.toMatch(
      /PRODUCT_NOT_READY|access.?token/i,
    );
  });

  it("API-013 API responses never expose encrypted-token internals or key material", async () => {
    vi.mocked(exchangePublicTokenForReview).mockResolvedValue({
      reviewId: "40000000-0000-0000-0000-000000000001",
      institution,
      accounts: [eligibleAccount],
    });

    const response = await exchange(
      jsonRequest("/api/plaid/exchange", {
        publicToken: "public-token-must-disappear",
        institution,
      }),
    );
    const serialized = JSON.stringify(await response.json());

    expect(serialized).not.toMatch(
      /public-token-must-disappear|access.?token|ciphertext|nonce|auth.?tag|encryption.?key/i,
    );
  });

  it("API-014 endpoint selection and server credentials never enter the browser contract", async () => {
    vi.mocked(createLinkTokenForMember).mockResolvedValue({
      linkToken: "link-production-or-sandbox",
      expiration: "2026-08-11T23:59:00.000Z",
    });

    const body = await (await linkToken()).json();

    expect(Object.keys(body).sort()).toEqual(["expiration", "linkToken"]);
    expect(JSON.stringify(body)).not.toMatch(
      /PLAID_ENV|sandbox\.plaid|production\.plaid|client.?id|secret/i,
    );
  });
});
