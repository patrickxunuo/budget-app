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
  return { ApiAuthError, requirePlaidApiActor: vi.fn() };
});

vi.mock("@/lib/plaid/connection-management", () => ({
  getPlaidConnections: vi.fn(),
  changePlaidAccountVisibility: vi.fn(),
  createPlaidUpdateToken: vi.fn(),
  reconcilePlaidConnection: vi.fn(),
  disconnectPlaidConnection: vi.fn(),
}));

import { requirePlaidApiActor, type PlaidApiActor } from "@/lib/auth/api";
import { PlaidFlowError } from "@/lib/plaid/errors";
import type { PlaidConnection } from "@/lib/plaid/types";
import * as management from "@/lib/plaid/connection-management";
import { dynamic, GET as listConnections } from "./connections/route";
import { POST as disconnect } from "./connections/[itemId]/disconnect/route";
import { POST as reconcile } from "./connections/[itemId]/reconcile/route";
import { POST as updateToken } from "./connections/[itemId]/update-token/route";
import { PATCH as visibility } from "./connections/[itemId]/visibility/route";

const actor: PlaidApiActor = {
  userId: "11000000-0000-4000-8000-000000000001",
  workspaceId: "12000000-0000-4000-8000-000000000001",
  membershipId: "13000000-0000-4000-8000-000000000001",
};
const itemId = "14000000-0000-4000-8000-000000000001";
const accountId = "15000000-0000-4000-8000-000000000001";
const returnedAccountId = "15000000-0000-4000-8000-000000000002";
const newAccountId = "15000000-0000-4000-8000-000000000003";
const connection: PlaidConnection = {
  itemId,
  institutionName: "Maple Test Bank",
  linkedBy: actor.userId,
  isLinker: true,
  status: "active",
  health: "healthy",
  lastSyncAt: "2026-08-12T18:00:00.000Z",
  consentExpiresAt: "2026-10-01T00:00:00.000Z",
  disconnectedAt: null,
  itemImpact: {
    accountCount: 2,
    liveAccountCount: 2,
    message: "Changes to this bank connection affect 2 accounts.",
  },
  accounts: [
    {
      accountId,
      providerAccountId: "provider-chequing-current",
      displayName: "Everyday Chequing",
      mask: "1204",
      kind: "chequing",
      scope: "personal",
      ownerProfileId: actor.userId,
      ownerDisplayName: "Connection Linker",
      availableBalanceCents: 123456,
      currentBalanceCents: 125000,
      balanceUpdatedAt: "2026-08-12T17:58:00.000Z",
      lastSyncAt: "2026-08-12T18:00:00.000Z",
      lifecycle: "live",
      readOnly: false,
      archivedAt: null,
    },
  ],
};
const baseAccount = connection.accounts[0]!;

function request(path: string, method: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function context(id = itemId) {
  return { params: Promise.resolve({ itemId: id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlaidApiActor).mockResolvedValue(actor);
});

describe("GH-11 Plaid connection-management routes", () => {
  it("API-001 lists only the linker's complete masked management dossier without caching", async () => {
    vi.mocked(management.getPlaidConnections).mockResolvedValue([connection]);

    const response = await listConnections();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(dynamic).toBe("force-dynamic");
    expect(body).toEqual({ connections: [connection] });
    expect(body.connections[0]).toMatchObject({
      linkedBy: actor.userId,
      isLinker: true,
      health: "healthy",
      itemImpact: { accountCount: 2, liveAccountCount: 2 },
      accounts: [
        expect.objectContaining({
          mask: "1204",
          ownerDisplayName: "Connection Linker",
          scope: "personal",
          availableBalanceCents: 123456,
          currentBalanceCents: 125000,
          lifecycle: "live",
          readOnly: false,
        }),
      ],
    });
    expect(management.getPlaidConnections).toHaveBeenCalledExactlyOnceWith(
      actor,
    );
    expect(JSON.stringify(body)).not.toMatch(
      /access.?token|ciphertext|client.?secret/i,
    );
  });

  it("API-002 rejects a non-linker workspace owner before mutating the Item", async () => {
    vi.mocked(management.changePlaidAccountVisibility).mockRejectedValue(
      new PlaidFlowError(
        403,
        "forbidden",
        "Only the member who linked this bank can manage it.",
      ),
    );

    const response = await visibility(
      request(`/api/plaid/connections/${itemId}/visibility`, "PATCH", {
        accountId,
        scope: "family",
        acknowledgeRetroactiveImpact: true,
      }),
      context(),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: "forbidden",
      message: "Only the member who linked this bank can manage it.",
    });
  });

  it.each([undefined, false])(
    "API-003 requires retroactive-impact acknowledgement (%s) and returns no success payload",
    async (acknowledgement) => {
      vi.mocked(management.changePlaidAccountVisibility).mockRejectedValue(
        new PlaidFlowError(
          400,
          "retroactive_acknowledgement_required",
          "Acknowledge the historical visibility impact before continuing.",
        ),
      );
      const payload: Record<string, unknown> = { accountId, scope: "family" };
      if (acknowledgement !== undefined)
        payload.acknowledgeRetroactiveImpact = acknowledgement;

      const response = await visibility(
        request(
          `/api/plaid/connections/${itemId}/visibility`,
          "PATCH",
          payload,
        ),
        context(),
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.code).toBe("retroactive_acknowledgement_required");
      expect(body).not.toHaveProperty("connection");
    },
  );

  it.each([
    ["family", null, "Personal-to-Family"],
    ["personal", actor.userId, "Family-to-Personal"],
  ] as const)(
    "API-004/API-005 changes visibility to %s and returns atomic recalculation context (%s)",
    async (scope, ownerProfileId, _direction) => {
      expect(_direction).toMatch(/-to-/);
      const updated: PlaidConnection = {
        ...connection,
        accounts: [{ ...baseAccount, scope, ownerProfileId }],
      };
      vi.mocked(management.changePlaidAccountVisibility).mockResolvedValue({
        connection: updated,
        recalculation: { dashboards: true, budgets: true },
      });
      const body = {
        accountId,
        scope,
        acknowledgeRetroactiveImpact: true,
      };

      const response = await visibility(
        request(`/api/plaid/connections/${itemId}/visibility`, "PATCH", body),
        context(),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        connection: {
          accounts: [expect.objectContaining({ scope, ownerProfileId })],
        },
        recalculation: { dashboards: true, budgets: true },
      });
      expect(
        management.changePlaidAccountVisibility,
      ).toHaveBeenCalledExactlyOnceWith(actor, itemId, body);
    },
  );

  it.each([
    "login_repair",
    "consent",
    "permissions",
    "account_selection",
  ] as const)(
    "API-006 creates an Item-scoped update token for %s with every affected account",
    async (reason) => {
      vi.mocked(management.createPlaidUpdateToken).mockResolvedValue({
        linkToken: `link-update-${reason}`,
        expiration: "2026-08-12T19:00:00.000Z",
        affectedAccountIds: [accountId, returnedAccountId],
      });
      const response = await updateToken(
        request(`/api/plaid/connections/${itemId}/update-token`, "POST", {
          reason,
        }),
        context(),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        linkToken: `link-update-${reason}`,
        expiration: "2026-08-12T19:00:00.000Z",
        affectedAccountIds: [accountId, returnedAccountId],
      });
      expect(management.createPlaidUpdateToken).toHaveBeenCalledExactlyOnceWith(
        actor,
        itemId,
        { reason },
      );
      expect(JSON.stringify(body)).not.toMatch(/access.?token|ciphertext/i);
    },
  );

  it("API-007/API-008 returns fresh reconciliation deltas and passes only explicit target-Item deletion IDs", async () => {
    vi.mocked(management.reconcilePlaidConnection).mockResolvedValue({
      connection: {
        ...connection,
        accounts: [
          {
            ...baseAccount,
            accountId: returnedAccountId,
            providerAccountId: "provider-returned-current",
          },
          {
            ...baseAccount,
            accountId: newAccountId,
            providerAccountId: "provider-new-current",
          },
        ],
      },
      addedAccountIds: [newAccountId],
      returnedAccountIds: [returnedAccountId],
      deselectedAccounts: [
        { ...baseAccount, lifecycle: "deselected", readOnly: true },
      ],
    });
    const body = { deleteDeselectedAccountIds: [accountId] };

    const response = await reconcile(
      request(`/api/plaid/connections/${itemId}/reconcile`, "POST", body),
      context(),
    );
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      addedAccountIds: [newAccountId],
      returnedAccountIds: [returnedAccountId],
      deselectedAccounts: [
        expect.objectContaining({
          accountId,
          lifecycle: "deselected",
          readOnly: true,
        }),
      ],
    });
    expect(
      result.connection.accounts.map(
        (account: { providerAccountId: string }) => account.providerAccountId,
      ),
    ).toEqual(["provider-returned-current", "provider-new-current"]);
    expect(management.reconcilePlaidConnection).toHaveBeenCalledExactlyOnceWith(
      actor,
      itemId,
      body,
    );
  });

  it("API-009 requires recent password confirmation without changing provider or local state", async () => {
    vi.mocked(management.disconnectPlaidConnection).mockRejectedValue(
      new PlaidFlowError(
        403,
        "recent_confirmation_required",
        "Confirm your password before disconnecting this bank.",
      ),
    );
    const response = await disconnect(
      request(`/api/plaid/connections/${itemId}/disconnect`, "POST", {
        mode: "keep_history",
      }),
      context(),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: "recent_confirmation_required",
      message: "Confirm your password before disconnecting this bank.",
    });
  });

  it.each(["keep_history", "delete_data"] as const)(
    "API-010/API-011 disconnects using %s and preserves the server-authoritative result",
    async (mode) => {
      vi.mocked(management.disconnectPlaidConnection).mockResolvedValue({
        itemId,
        mode,
        disconnected: true,
      });
      const response = await disconnect(
        request(`/api/plaid/connections/${itemId}/disconnect`, "POST", {
          mode,
        }),
        context(),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        itemId,
        mode,
        disconnected: true,
      });
      expect(
        management.disconnectPlaidConnection,
      ).toHaveBeenCalledExactlyOnceWith(actor, itemId, { mode });
    },
  );

  it("API-013 sanitizes provider and database failures without secret-bearing payloads", async () => {
    const raw = Object.assign(
      new Error("PLAID_ERROR access-sandbox-secret database detail"),
      {
        response: {
          data: {
            error_code: "ITEM_LOGIN_REQUIRED",
            request_id: "raw-provider-request",
          },
        },
      },
    );
    vi.mocked(management.reconcilePlaidConnection).mockRejectedValue(raw);

    const response = await reconcile(
      request(`/api/plaid/connections/${itemId}/reconcile`, "POST", {}),
      context(),
    );
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(502);
    expect(serialized).toMatch(/unexpected_error|could not|try again/i);
    expect(serialized).not.toMatch(
      /PLAID_ERROR|ITEM_LOGIN_REQUIRED|access-sandbox-secret|database detail|raw-provider-request/i,
    );
  });

  it("API-014 returns the same successful result for an already-disconnected Item", async () => {
    vi.mocked(management.disconnectPlaidConnection).mockResolvedValue({
      itemId,
      mode: "keep_history",
      disconnected: true,
    });
    const first = await disconnect(
      request(`/api/plaid/connections/${itemId}/disconnect`, "POST", {
        mode: "keep_history",
      }),
      context(),
    );
    const repeat = await disconnect(
      request(`/api/plaid/connections/${itemId}/disconnect`, "POST", {
        mode: "keep_history",
      }),
      context(),
    );

    expect([first.status, repeat.status]).toEqual([200, 200]);
    expect(await repeat.json()).toEqual({
      itemId,
      mode: "keep_history",
      disconnected: true,
    });
  });
});
