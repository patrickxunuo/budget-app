import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiContext: vi.fn(),
  listCategoriesAndRules: vi.fn(),
  listTransactions: vi.fn(),
  readDashboard: vi.fn(),
  getManualEntryContext: vi.fn(),
  listManualEntries: vi.fn(),
  delayRouteForE2E: vi.fn(),
}));

vi.mock("@/lib/categories/service", () => ({
  getApiContext: mocks.getApiContext,
  listCategoriesAndRules: mocks.listCategoriesAndRules,
  listTransactions: mocks.listTransactions,
}));
vi.mock("@/lib/dashboard/service", () => ({
  readDashboard: mocks.readDashboard,
}));
vi.mock("@/lib/manual-entries/service", () => ({
  getManualEntryContext: mocks.getManualEntryContext,
  listManualEntries: mocks.listManualEntries,
}));
vi.mock("@/lib/testing/route-loading-delay", () => ({
  delayRouteForE2E: mocks.delayRouteForE2E,
}));
vi.mock("@/components/transactions/transaction-explorer", () => ({
  TransactionExplorer: () => <section data-testid="transactions-explorer" />,
}));
vi.mock("@/components/transactions/manual-entry-workbench", () => ({
  ManualEntryWorkbench: ({
    viewScope,
    categories,
  }: {
    viewScope: string;
    categories: Array<{ id: string }>;
  }) => (
    <section
      data-testid="manual-entry-workbench"
      data-scope={viewScope}
      data-categories={categories.map((category) => category.id).join(",")}
    />
  ),
}));
vi.mock("@/components/transactions/transaction-ledger", () => ({
  TransactionLedger: () => <section data-testid="transaction-ledger" />,
}));
vi.mock("@/components/transactions/transaction-management-navigation", () => ({
  TransactionManagementMenu: ({
    scope,
    returnTo,
  }: {
    scope: string;
    returnTo: string;
  }) => (
    <nav
      data-testid="transactions-manage-menu"
      data-scope={scope}
      data-return-to={returnTo}
    />
  ),
  TransactionManagementBackLink: ({ href }: { href: string }) => (
    <a data-testid="back-to-transactions" href={href}>
      Back to Transactions
    </a>
  ),
}));

import ManualTransactionsPage from "./manual/page";
import TransactionsPage from "./page";
import PlaidTransactionsPage from "./plaid/page";

const apiContext = { userId: "user-1", workspaceId: "workspace-1" };
const manualContext = { userId: "user-1", workspaceId: "workspace-1" };
const dashboardModel = { scope: "family", transactions: [] };
const activeCategory = { id: "active", archivedAt: null };
const archivedCategory = { id: "archived", archivedAt: "2026-08-01T00:00:00Z" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApiContext.mockResolvedValue(apiContext);
  mocks.getManualEntryContext.mockResolvedValue(manualContext);
  mocks.readDashboard.mockResolvedValue(dashboardModel);
  mocks.listManualEntries.mockResolvedValue([]);
  mocks.listTransactions.mockResolvedValue([]);
  mocks.listCategoriesAndRules.mockResolvedValue({
    categories: [activeCategory, archivedCategory],
    rules: [],
  });
});

describe("GH-64 transaction route boundaries", () => {
  it("API-001 renders only the read-only explorer and never fetches a management dataset", async () => {
    render(
      await TransactionsPage({
        searchParams: Promise.resolve({
          scope: "personal",
          period: "week",
          reference: "2026-08-24",
          search: "coffee",
        }),
      }),
    );

    expect(screen.getByTestId("transactions-explorer")).toBeInTheDocument();
    expect(screen.queryByTestId("manual-entry-workbench")).toBeNull();
    expect(screen.queryByTestId("transaction-ledger")).toBeNull();
    expect(mocks.getApiContext).toHaveBeenCalledTimes(1);
    expect(mocks.readDashboard).toHaveBeenCalledTimes(1);
    expect(mocks.getManualEntryContext).not.toHaveBeenCalled();
    expect(mocks.listManualEntries).not.toHaveBeenCalled();
    expect(mocks.listTransactions).not.toHaveBeenCalled();
    expect(mocks.listCategoriesAndRules).not.toHaveBeenCalled();
  });

  it.each(["family", "personal"] as const)(
    "API-002 renders the %s Manual route from independently authorized scoped rows and active categories",
    async (scope) => {
      render(
        await ManualTransactionsPage({
          searchParams: Promise.resolve({
            scope,
            returnTo: `/transactions?scope=${scope}&period=week&reference=2026-08-24`,
          }),
        }),
      );

      expect(screen.getByTestId("manual-management-page")).toBeInTheDocument();
      expect(screen.getByTestId("manual-entry-workbench")).toHaveAttribute(
        "data-scope",
        scope,
      );
      expect(screen.queryByTestId("transactions-explorer")).toBeNull();
      expect(screen.queryByTestId("transaction-ledger")).toBeNull();
      expect(mocks.getManualEntryContext).toHaveBeenCalledTimes(1);
      expect(mocks.listManualEntries).toHaveBeenCalledWith(manualContext, {
        scope,
      });
      expect(mocks.getApiContext).toHaveBeenCalledTimes(1);
      expect(mocks.listCategoriesAndRules).toHaveBeenCalledWith(apiContext);
      expect(screen.getByTestId("manual-entry-workbench")).toHaveAttribute(
        "data-categories",
        "active",
      );
      expect(mocks.listTransactions).not.toHaveBeenCalled();
      expect(screen.getByTestId("back-to-transactions")).toHaveAttribute(
        "href",
        expect.stringContaining("/transactions"),
      );
    },
  );

  it.each(["family", "personal"] as const)(
    "API-003 renders the %s Plaid route from independently authorized scoped rows and category/rule context",
    async (scope) => {
      render(
        await PlaidTransactionsPage({
          searchParams: Promise.resolve({ scope }),
        }),
      );

      expect(screen.getByTestId("plaid-management-page")).toBeInTheDocument();
      expect(screen.getByTestId("transaction-ledger")).toBeInTheDocument();
      expect(screen.queryByTestId("transactions-explorer")).toBeNull();
      expect(screen.queryByTestId("manual-entry-workbench")).toBeNull();
      expect(mocks.getApiContext).toHaveBeenCalledTimes(1);
      expect(mocks.listTransactions).toHaveBeenCalledWith(
        apiContext,
        undefined,
        undefined,
        { scope },
      );
      expect(mocks.listCategoriesAndRules).toHaveBeenCalledWith(apiContext);
      expect(mocks.listManualEntries).not.toHaveBeenCalled();
      expect(screen.getByTestId("back-to-transactions")).toHaveAttribute(
        "href",
        `/transactions?scope=${scope}`,
      );
    },
  );
});
