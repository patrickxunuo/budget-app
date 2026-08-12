import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionLedger } from "./transaction-ledger";

const userId = "10000000-0000-4000-8000-000000000001";
const transactionId = "40000000-0000-4000-8000-000000000001";
const categories = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    name: "Groceries",
    color: "#18745b",
    scope: "family" as const,
    ownerProfileId: null,
    systemKey: null,
    archivedAt: null,
    inUse: true,
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    name: "Dining out",
    color: "#b56b45",
    scope: "family" as const,
    ownerProfileId: null,
    systemKey: null,
    archivedAt: null,
    inUse: false,
  },
];
const transaction = {
  id: transactionId,
  scope: "family" as const,
  ownerProfileId: null,
  merchantName: "Green Market",
  name: "GREEN MARKET 042",
  amount: 42.75,
  transactionDate: "2026-08-11",
  pending: false,
  originalPlaidCategory: {
    primary: "FOOD_AND_DRINK",
    detailed: "FOOD_AND_DRINK_GROCERIES",
  },
  effectiveCategory: {
    id: categories[0]!.id,
    name: categories[0]!.name,
    color: categories[0]!.color,
    source: "plaid" as const,
    updatedBy: null,
    updatedAt: null,
  },
  stableMerchantId: "entity-green-market",
  normalizedMerchant: "green market",
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("GH-7 transaction ledger acceptance", () => {
  it("FE-003 shows original Plaid and effective categories side by side and saves a one-off manual override", async () => {
    const updated = {
      ...transaction,
      effectiveCategory: {
        id: categories[1]!.id,
        name: categories[1]!.name,
        color: categories[1]!.color,
        source: "manual" as const,
        updatedBy: userId,
        updatedAt: "2026-08-12T16:00:00.000Z",
      },
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => jsonResponse({ transaction: updated }));

    render(
      <TransactionLedger
        initialTransactions={[transaction]}
        categories={categories}
      />,
    );

    expect(screen.getByTestId("transaction-ledger")).toBeVisible();
    const row = screen.getByTestId(`transaction-row-${transactionId}`);
    expect(
      within(row).getByTestId(`original-category-${transactionId}`),
    ).toHaveTextContent(/food.*drink|grocer/i);
    expect(
      within(row).getByTestId(`effective-category-${transactionId}`),
    ).toHaveTextContent(/groceries/i);

    fireEvent.change(
      within(row).getByTestId(`category-select-${transactionId}`),
      { target: { value: categories[1]!.id } },
    );
    fireEvent.click(within(row).getByTestId(`category-save-${transactionId}`));

    await waitFor(() =>
      expect(
        within(row).getByTestId(`effective-category-${transactionId}`),
      ).toHaveTextContent(/dining out/i),
    );
    expect(
      within(row).getByTestId(`original-category-${transactionId}`),
    ).toHaveTextContent(/food.*drink|grocer/i);
    expect(
      within(row).getByTestId(`effective-category-${transactionId}`),
    ).toHaveTextContent(/manual/i);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/transactions/${transactionId}/category`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ categoryId: categories[1]!.id }),
      }),
    );
  });

  it("FE-004 previews the affected transaction count before confirmation and announces the applied count", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = String(input);
        if (url === "/api/merchant-rules/preview") {
          return jsonResponse({
            matcher: {
              matchType: "merchant_id",
              matchValue: "entity-green-market",
            },
            matchCount: 3,
          });
        }
        if (url === "/api/merchant-rules" && init?.method === "POST") {
          return jsonResponse(
            {
              rule: {
                id: "50000000-0000-4000-8000-000000000001",
                categoryId: categories[0]!.id,
                scope: "family",
                ownerProfileId: null,
                matchType: "merchant_id",
                matchValue: "entity-green-market",
                enabled: true,
                archivedAt: null,
                createdBy: userId,
                createdAt: "2026-08-12T16:00:00.000Z",
                updatedAt: "2026-08-12T16:00:00.000Z",
              },
              updatedCount: 3,
            },
            201,
          );
        }
        return jsonResponse({ error: "Unexpected request" }, 500);
      });

    render(
      <TransactionLedger
        initialTransactions={[transaction]}
        categories={categories}
      />,
    );

    const row = screen.getByTestId(`transaction-row-${transactionId}`);
    fireEvent.change(
      within(row).getByTestId(`category-select-${transactionId}`),
      {
        target: { value: categories[0]!.id },
      },
    );
    fireEvent.click(within(row).getByTestId(`rule-create-${transactionId}`));

    const previewCount = await screen.findByTestId("rule-preview-count");
    expect(previewCount).toHaveTextContent(/3/);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/merchant-rules/preview",
      expect.objectContaining({ method: "POST" }),
    );

    fireEvent.click(screen.getByTestId("rule-confirm"));

    const status = document.querySelector('[aria-live="polite"]');
    expect(status).not.toBeNull();
    expect(status).toHaveAttribute("aria-live", "polite");
    await waitFor(() =>
      expect(status).toHaveTextContent(/3.*applied|applied.*3/i),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/merchant-rules",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"applyExisting":true'),
      }),
    );
  });
});
