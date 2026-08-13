import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const plaid = vi.hoisted(() => ({
  open: vi.fn(),
  readyForToken: false,
  token: null as string | null,
  config: undefined as
    | {
        token?: string | null;
        onSuccess?: (publicToken: string, metadata: unknown) => void;
        onExit?: (error: unknown, metadata: unknown) => void;
      }
    | undefined,
}));

vi.mock("react-plaid-link", () => ({
  usePlaidLink: (config: typeof plaid.config) => {
    plaid.config = config;
    plaid.token = config?.token ?? null;
    return {
      open: plaid.open,
      ready: plaid.token === null || plaid.readyForToken,
      error: null,
      exit: vi.fn(),
    };
  },
}));

import type { PlaidConnection } from "@/lib/plaid/types";
import { PlaidConnectionManager } from "./plaid-connection-manager";

const itemId = "14000000-0000-4000-8000-000000000001";
const personalId = "15000000-0000-4000-8000-000000000001";
const familyId = "15000000-0000-4000-8000-000000000002";
const initialConnection: PlaidConnection = {
  itemId,
  institutionName: "Maple Test Bank",
  linkedBy: "11000000-0000-4000-8000-000000000001",
  isLinker: true,
  status: "active",
  health: "healthy",
  lastSyncAt: "2026-08-12T18:00:00.000Z",
  consentExpiresAt: "2026-10-01T00:00:00.000Z",
  disconnectedAt: null,
  itemImpact: {
    accountCount: 2,
    liveAccountCount: 2,
    message: "Changes to this bank connection affect both accounts.",
  },
  accounts: [
    {
      accountId: personalId,
      providerAccountId: "provider-chequing-current",
      displayName: "Everyday Chequing",
      mask: "1204",
      kind: "chequing",
      scope: "personal",
      ownerProfileId: "11000000-0000-4000-8000-000000000001",
      ownerDisplayName: "Connection Linker",
      availableBalanceCents: 123456,
      currentBalanceCents: 125000,
      balanceUpdatedAt: "2026-08-12T17:58:00.000Z",
      lastSyncAt: "2026-08-12T18:00:00.000Z",
      lifecycle: "live",
      readOnly: false,
      archivedAt: null,
    },
    {
      accountId: familyId,
      providerAccountId: "provider-savings-current",
      displayName: "Family Savings",
      mask: "4410",
      kind: "savings",
      scope: "family",
      ownerProfileId: null,
      ownerDisplayName: "Family",
      availableBalanceCents: null,
      currentBalanceCents: 840000,
      balanceUpdatedAt: "2026-08-12T17:56:00.000Z",
      lastSyncAt: "2026-08-12T18:00:00.000Z",
      lifecycle: "live",
      readOnly: false,
      archivedAt: null,
    },
  ],
};

function response(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  plaid.open.mockReset();
  plaid.readyForToken = false;
  plaid.token = null;
  plaid.config = undefined;
});

describe("GH-11 PlaidConnectionManager", () => {
  it("FE-001 renders the linker-only institution and account dossier with non-color health and Item impact", () => {
    render(<PlaidConnectionManager initialConnections={[initialConnection]} />);

    expect(screen.getByTestId("plaid-connections")).toBeVisible();
    const dossier = screen.getByTestId(`plaid-connection-${itemId}`);
    expect(dossier).toHaveTextContent(/Maple Test Bank/i);
    expect(screen.getByTestId(`plaid-health-${itemId}`)).toHaveTextContent(
      /healthy|connected|current/i,
    );
    expect(
      screen.getByTestId(`plaid-health-${itemId}`).textContent?.trim(),
    ).not.toBe("");
    expect(screen.getByTestId(`plaid-item-impact-${itemId}`)).toHaveTextContent(
      /both accounts|2 accounts/i,
    );

    const personal = screen.getByTestId(`plaid-account-${personalId}`);
    expect(personal).toHaveTextContent(/Everyday Chequing/i);
    expect(personal).toHaveTextContent(/1204/);
    expect(personal).toHaveTextContent(/Connection Linker|you/i);
    expect(personal).toHaveTextContent(/personal/i);
    expect(personal).toHaveTextContent(/1,234\.56|\$1,234\.56/);
    expect(personal).toHaveTextContent(/1,250\.00|\$1,250\.00/);
    expect(personal).toHaveTextContent(/last sync|updated|Aug 12/i);

    const family = screen.getByTestId(`plaid-account-${familyId}`);
    expect(family).toHaveTextContent(/Family Savings/i);
    expect(family).toHaveTextContent(/4410/);
    expect(family).toHaveTextContent(/family/i);
    expect(family).toHaveTextContent(/8,400\.00|\$8,400\.00/);
    expect(dossier).not.toHaveTextContent(
      /access.?token|ciphertext|provider-account/i,
    );
  });

  it("FE-002 requires the irreversible retroactive warning before changing visibility and refreshes the dossier", async () => {
    const updatedConnection = {
      ...initialConnection,
      accounts: initialConnection.accounts.map((account) =>
        account.accountId === personalId
          ? {
              ...account,
              scope: "family" as const,
              ownerProfileId: null,
              ownerDisplayName: "Family",
            }
          : account,
      ),
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        if (String(input).endsWith(`/visibility`) && init?.method === "PATCH") {
          return response({
            connection: updatedConnection,
            recalculation: { dashboards: true, budgets: true },
          });
        }
        return response({ connections: [updatedConnection] });
      });

    render(<PlaidConnectionManager initialConnections={[initialConnection]} />);
    fireEvent.change(screen.getByTestId(`plaid-visibility-${personalId}`), {
      target: { value: "family" },
    });

    const warning = screen.getByTestId(
      `plaid-visibility-warning-${personalId}`,
    );
    expect(warning).toHaveTextContent(/retroactive|past|history/i);
    expect(warning).toHaveTextContent(/dashboard|budget|recalculat/i);
    expect(warning).toHaveTextContent(
      /cannot undo|can(?:not|'t) undo|prior viewing|export/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();

    const apply = within(warning).getByRole("button", {
      name: /acknowledge|confirm|apply|change visibility/i,
    });
    expect(apply).toBeDisabled();
    fireEvent.click(
      within(warning).getByRole("checkbox", {
        name: /acknowledge|irreversible|historical/i,
      }),
    );
    expect(apply).toBeEnabled();
    fireEvent.click(apply);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/plaid/connections/${itemId}/visibility`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            accountId: personalId,
            scope: "family",
            acknowledgeRetroactiveImpact: true,
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId(`plaid-account-${personalId}`),
      ).toHaveTextContent(/family/i),
    );
    expect(screen.getByTestId("plaid-operation-status")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("FE-003 opens Plaid update mode, reconciles the real Item result, and offers scoped deselected deletion", async () => {
    const deselected = {
      ...initialConnection.accounts[1],
      lifecycle: "deselected" as const,
      readOnly: true,
      archivedAt: "2026-08-12T18:30:00.000Z",
    };
    const reconciled = {
      ...initialConnection,
      accounts: [initialConnection.accounts[0], deselected],
      itemImpact: { ...initialConnection.itemImpact, liveAccountCount: 1 },
    };
    let reconciliationCount = 0;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) => {
        const url = String(input);
        if (url.endsWith("/update-token")) {
          return response({
            linkToken: "link-update-account-selection",
            expiration: "2026-08-12T19:00:00.000Z",
            affectedAccountIds: [personalId, familyId],
          });
        }
        if (url.endsWith("/reconcile")) {
          reconciliationCount += 1;
          return response({
            connection: reconciled,
            addedAccountIds: ["15000000-0000-4000-8000-000000000003"],
            returnedAccountIds: [personalId],
            deselectedAccounts: [deselected],
          });
        }
        return response({ connections: [reconciled] });
      });

    const { rerender } = render(
      <PlaidConnectionManager initialConnections={[initialConnection]} />,
    );
    fireEvent.click(screen.getByTestId(`plaid-update-${itemId}`));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/plaid/connections/${itemId}/update-token`,
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() =>
      expect(plaid.token).toBe("link-update-account-selection"),
    );
    expect(plaid.open).not.toHaveBeenCalled();

    plaid.readyForToken = true;
    rerender(
      <PlaidConnectionManager initialConnections={[initialConnection]} />,
    );
    await waitFor(() => expect(plaid.open).toHaveBeenCalledTimes(1));
    plaid.config?.onSuccess?.("public-update-success", {
      institution: { institution_id: "ins-maple", name: "Maple Test Bank" },
    });

    await waitFor(() => expect(reconciliationCount).toBe(1));
    expect(screen.getByTestId("plaid-operation-status")).toHaveTextContent(
      /returned|new|added|deselected/i,
    );
    const row = screen.getByTestId(`plaid-deselected-${familyId}`);
    expect(row).toHaveTextContent(/read.only|deselected|no longer selected/i);
    expect(
      screen.getByTestId(`plaid-delete-deselected-${familyId}`),
    ).toBeVisible();

    fireEvent.click(screen.getByTestId(`plaid-delete-deselected-${familyId}`));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        `/api/plaid/connections/${itemId}/reconcile`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ deleteDeselectedAccountIds: [familyId] }),
        }),
      ),
    );
  });

  it("FE-003 deterministic update tokens reconcile without opening the production Plaid hook", async () => {
    let reconciliationCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/update-token")) {
        return response({
          linkToken: "e2e-deterministic-account-selection",
          expiration: "2026-08-12T19:00:00.000Z",
          affectedAccountIds: [personalId, familyId],
        });
      }
      if (url.endsWith("/reconcile")) {
        reconciliationCount += 1;
        return response({
          connection: initialConnection,
          addedAccountIds: [],
          returnedAccountIds: [],
          deselectedAccounts: [],
        });
      }
      return response({ connections: [initialConnection] });
    });

    render(<PlaidConnectionManager initialConnections={[initialConnection]} />);
    fireEvent.click(screen.getByTestId(`plaid-update-${itemId}`));

    await waitFor(() => expect(reconciliationCount).toBe(1));
    expect(plaid.open).not.toHaveBeenCalled();
    expect(screen.getByTestId("plaid-operation-status")).toHaveTextContent(
      /reconciliation complete/i,
    );
  });
  it("FE-004 distinguishes disconnect consequences, requires explicit confirmation, and announces completion", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        if (String(input).endsWith("/disconnect") && init?.method === "POST") {
          return response({ itemId, mode: "keep_history", disconnected: true });
        }
        return response({ connections: [] });
      });

    render(<PlaidConnectionManager initialConnections={[initialConnection]} />);
    fireEvent.click(screen.getByTestId(`plaid-disconnect-${itemId}`));
    const impact = screen.getByTestId(`plaid-item-impact-${itemId}`);
    expect(impact).toHaveTextContent(/both accounts|2 accounts/i);

    const mode = screen.getByTestId(`plaid-disconnect-mode-${itemId}`);
    expect(mode).toHaveTextContent(/keep.*history|history.*keep/i);
    expect(mode).toHaveTextContent(/delete.*data|data.*delete/i);
    expect(mode).toHaveTextContent(/read.only|retain|keep/i);
    expect(mode).toHaveTextContent(/remove|delete/i);
    fireEvent.change(mode, { target: { value: "keep_history" } });

    const confirmation = screen.getByTestId(
      `plaid-disconnect-confirm-${itemId}`,
    );
    expect(confirmation).toHaveTextContent(/affects 2 accounts/i);
    const confirm = within(confirmation).getByRole("button", {
      name: /confirm disconnect/i,
    });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/plaid/connections/${itemId}/disconnect`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ mode: "keep_history" }),
        }),
      ),
    );
    expect(screen.getByTestId("plaid-operation-status")).toHaveTextContent(
      /disconnected|history.*kept/i,
    );
  });

  it("FE-005 provides named keyboard controls, focus visibility hooks, reduced-motion safety, and overflow-safe layout", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    render(<PlaidConnectionManager initialConnections={[initialConnection]} />);

    for (const id of [
      `plaid-visibility-${personalId}`,
      `plaid-update-${itemId}`,
      `plaid-reconcile-${itemId}`,
      `plaid-disconnect-${itemId}`,
    ]) {
      expect(screen.getByTestId(id)).toHaveAccessibleName();
    }
    const update = screen.getByTestId(`plaid-update-${itemId}`);
    update.focus();
    expect(update).toHaveFocus();
    expect(screen.getByTestId(`plaid-connection-${itemId}`).className).toMatch(
      /overflow(?:-x)?-hidden|max-w-full|w-full/,
    );
    expect(
      screen.getByTestId(`plaid-health-${itemId}`).textContent?.trim(),
    ).not.toBe("");
  });
});
