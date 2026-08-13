import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FinancialDashboard } from "./financial-dashboard";

const initialModel = {
  scope: "family" as const,
  period: "month" as const,
  range: { startDate: "2026-08-01", endDate: "2026-08-31" },
  timeZone: "America/Toronto",
  summary: {
    incomeCents: 300000,
    spendingCents: 13750,
    netFlowCents: 286250,
    pendingAmountCents: 2500,
    pendingCount: 1,
    includedCount: 3,
    excludedCount: 1,
  },
  trend: [
    { date: "2026-08-11", incomeCents: 0, spendingCents: 11250 },
    { date: "2026-08-12", incomeCents: 300000, spendingCents: 2500 },
  ],
  categories: [
    {
      id: "cat-grocery",
      name: "Groceries",
      color: "#18745b",
      spendingCents: 13750,
      budgetCents: 10000,
      progressPercent: 137.5,
    },
  ],
  accounts: [
    {
      id: "account-chequing",
      name: "Household Chequing",
      mask: "1234",
      subtype: "chequing" as const,
      availableCents: 192500,
      currentCents: 200000,
      freshnessAt: "2026-08-12T12:00:00.000Z",
    },
    {
      id: "account-credit",
      name: "Family Credit",
      mask: "9876",
      subtype: "credit_card" as const,
      availableCents: null,
      currentCents: -4250,
      freshnessAt: null,
    },
  ],
  transactions: [
    {
      id: "plaid-pending",
      source: "plaid" as const,
      scope: "family" as const,
      accountId: "account-chequing",
      accountName: "Household Chequing",
      merchantOrDescription: "Green Market",
      category: { id: "cat-grocery", name: "Groceries", color: "#18745b" },
      amountCents: -2500,
      date: "2026-08-12",
      pending: true,
      kind: "spending" as const,
      excluded: false,
    },
    {
      id: "manual-refund",
      source: "manual" as const,
      scope: "family" as const,
      accountId: null,
      accountName: null,
      merchantOrDescription: "Market refund",
      category: { id: "cat-grocery", name: "Groceries", color: "#18745b" },
      amountCents: 500,
      date: "2026-08-12",
      pending: false,
      kind: "refund" as const,
      excluded: false,
    },
    {
      id: "excluded-transfer",
      source: "plaid" as const,
      scope: "family" as const,
      accountId: "account-chequing",
      accountName: "Household Chequing",
      merchantOrDescription: "Card payment",
      category: null,
      amountCents: -50000,
      date: "2026-08-10",
      pending: false,
      kind: "transfer" as const,
      excluded: true,
    },
  ],
  filterOptions: {
    accounts: [{ id: "account-chequing", name: "Household Chequing" }],
    categories: [{ id: "cat-grocery", name: "Groceries" }],
  },
};

const personalModel = {
  ...initialModel,
  scope: "personal" as const,
  summary: {
    ...initialModel.summary,
    incomeCents: 125000,
    spendingCents: 4200,
    netFlowCents: 120800,
    pendingAmountCents: 0,
    pendingCount: 0,
    includedCount: 1,
  },
  trend: [{ date: "2026-08-12", incomeCents: 125000, spendingCents: 4200 }],
  categories: [
    { ...initialModel.categories[0], spendingCents: 4200, progressPercent: 42 },
  ],
  accounts: [
    {
      ...initialModel.accounts[0],
      id: "account-personal",
      name: "Private Savings",
      availableCents: 750000,
    },
  ],
  transactions: [
    {
      ...initialModel.transactions[0],
      id: "personal-row",
      scope: "personal" as const,
      pending: false,
      merchantOrDescription: "Private purchase",
      amountCents: -4200,
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
});

describe("GH-9 financial dashboard acceptance", () => {
  it("FE-001 switches Family to Personal and atomically replaces every region without a Combined scope", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => response(personalModel));
    render(<FinancialDashboard initialModel={initialModel} />);
    expect(
      screen.queryByRole("button", { name: /combined/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("dashboard-scope-personal"));
    expect(screen.getByTestId("dashboard-loading")).toHaveAttribute(
      "aria-live",
    );
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-summary-income")).toHaveTextContent(
        /1,250\.00/,
      ),
    );
    expect(screen.getByTestId("dashboard-cash-flow-chart")).toHaveTextContent(
      /1,250\.00|1250/,
    );
    expect(screen.getByTestId("dashboard-category-list")).toHaveTextContent(
      /42\.00/,
    );
    expect(screen.getByTestId("dashboard-account-list")).toHaveTextContent(
      /private savings/i,
    );
    expect(screen.getByTestId("dashboard-transaction-list")).toHaveTextContent(
      /private purchase/i,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/dashboard\?.*scope=personal/),
      expect.anything(),
    );
  });

  it("FE-002 navigates periods and submits custom dates while preserving calendar semantics", async () => {
    const previous = {
      ...initialModel,
      range: { startDate: "2026-07-01", endDate: "2026-07-31" },
    };
    const custom = {
      ...initialModel,
      period: "custom" as const,
      range: { startDate: "2026-08-03", endDate: "2026-08-09" },
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) =>
        response(String(input).includes("period=custom") ? custom : previous),
      );
    render(<FinancialDashboard initialModel={initialModel} />);
    fireEvent.click(screen.getByTestId("dashboard-previous-period"));
    await screen.findByText(
      /jul(?:y)? 1.*jul(?:y)? 31|2026-07-01.*2026-07-31/i,
    );
    fireEvent.click(screen.getByTestId("dashboard-period-custom"));
    fireEvent.change(screen.getByLabelText(/^from$/i), {
      target: { value: "2026-08-03" },
    });
    fireEvent.change(screen.getByLabelText(/^to$/i), {
      target: { value: "2026-08-09" },
    });
    fireEvent.click(screen.getByRole("button", { name: /apply|show custom/i }));
    await screen.findByText(
      /aug(?:ust)? 3.*aug(?:ust)? 9|2026-08-03.*2026-08-09/i,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/period=custom.*from=2026-08-03.*to=2026-08-09/),
      expect.anything(),
    );
    expect(screen.getByTestId("dashboard-period-week")).toHaveAccessibleName(
      /week.*monday|monday.*sunday/i,
    );
    expect(screen.getByTestId("dashboard-next-period")).toBeEnabled();
  });

  it("FE-003 combines search/account/category/status/inclusion filters and keeps semantic row labels visible", async () => {
    const filtered = {
      ...initialModel,
      transactions: [initialModel.transactions[0]],
      summary: {
        ...initialModel.summary,
        spendingCents: 2500,
        includedCount: 1,
      },
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => response(filtered));
    render(<FinancialDashboard initialModel={initialModel} />);
    fireEvent.change(screen.getByTestId("dashboard-search"), {
      target: { value: " green " },
    });
    fireEvent.change(screen.getByTestId("dashboard-account-filter"), {
      target: { value: "account-chequing" },
    });
    fireEvent.change(screen.getByTestId("dashboard-category-filter"), {
      target: { value: "cat-grocery" },
    });
    fireEvent.change(screen.getByTestId("dashboard-status-filter"), {
      target: { value: "pending" },
    });
    fireEvent.change(screen.getByTestId("dashboard-inclusion-filter"), {
      target: { value: "all" },
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.stringMatching(/search=green/),
        expect.anything(),
      ),
    );
    const ledger = screen.getByTestId("dashboard-transaction-list");
    expect(ledger).toHaveTextContent(/pending/i);
    expect(ledger).toHaveTextContent(/plaid/i);
    expect(screen.getByTestId("dashboard-summary-spending")).toHaveTextContent(
      /25\.00/,
    );
  });

  it("FE-004 renders CAD summaries, accessible chart data, over-budget state, unavailable balance, and freshness", () => {
    render(<FinancialDashboard initialModel={initialModel} />);
    expect(screen.getByTestId("dashboard-summary-income")).toHaveTextContent(
      /CAD|\$/,
    );
    expect(screen.getByTestId("dashboard-summary-spending")).toHaveTextContent(
      /137\.50/,
    );
    expect(screen.getByTestId("dashboard-summary-net")).toHaveTextContent(
      /2,862\.50/,
    );
    expect(screen.getByTestId("dashboard-summary-pending")).toHaveTextContent(
      /25\.00.*1|1.*25\.00/,
    );
    expect(
      within(screen.getByTestId("dashboard-cash-flow-chart")).getByRole(
        "table",
      ),
    ).toBeVisible();
    expect(screen.getByTestId("dashboard-budget-list")).toHaveTextContent(
      /137\.5%|over budget/i,
    );
    expect(screen.getByTestId("dashboard-account-list")).toHaveTextContent(
      /unavailable/i,
    );
    expect(screen.getByTestId("dashboard-account-list")).toHaveTextContent(
      /updated|fresh|as of/i,
    );
  });

  it("FE-005 announces a refresh error and retains the last successful model as usable", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      response({ error: "Dashboard refresh failed. Try again." }, 503),
    );
    render(<FinancialDashboard initialModel={initialModel} />);
    fireEvent.click(screen.getByTestId("dashboard-scope-personal"));
    const error = await screen.findByTestId("dashboard-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent(/try again|retry/i);
    expect(screen.getByTestId("dashboard-summary-income")).toHaveTextContent(
      /3,000\.00/,
    );
    expect(screen.getByTestId("dashboard-transaction-list")).toHaveTextContent(
      /green market/i,
    );
    expect(screen.getByTestId("dashboard-scope-family")).toBeEnabled();
  });

  it("FE-006 exposes keyboard names, reduced-motion behavior, visible focus, and an overflow-safe responsive surface", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    render(<FinancialDashboard initialModel={initialModel} />);
    for (const id of [
      "dashboard-scope-family",
      "dashboard-scope-personal",
      "dashboard-period-day",
      "dashboard-period-week",
      "dashboard-period-month",
      "dashboard-period-custom",
      "dashboard-previous-period",
      "dashboard-next-period",
      "dashboard-search",
      "dashboard-account-filter",
      "dashboard-category-filter",
      "dashboard-status-filter",
      "dashboard-inclusion-filter",
    ]) {
      expect(screen.getByTestId(id)).toHaveAccessibleName();
    }
    const search = screen.getByTestId("dashboard-search");
    search.focus();
    expect(search).toHaveFocus();
    expect(screen.getByTestId("dashboard-cash-flow-chart")).not.toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByTestId("dashboard-transaction-list").className).toMatch(
      /overflow-x-(?:auto|hidden)|max-w-full|w-full/,
    );
  });
});

describe("GH-12 dashboard CSV export", () => {
  it("FE-001 keeps the export href synchronized with the exact applied filter state and disables it during refresh", async () => {
    const refreshed = {
      ...initialModel,
      period: "custom" as const,
      range: { startDate: "2026-08-03", endDate: "2026-08-09" },
      scope: "personal" as const,
    };
    let resolveRefresh!: (value: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    render(<FinancialDashboard initialModel={initialModel} />);
    fireEvent.click(screen.getByTestId("dashboard-scope-personal"));
    fireEvent.change(screen.getByTestId("dashboard-search"), {
      target: { value: " green market " },
    });
    fireEvent.change(screen.getByTestId("dashboard-account-filter"), {
      target: { value: "account-chequing" },
    });
    fireEvent.change(screen.getByTestId("dashboard-category-filter"), {
      target: { value: "cat-grocery" },
    });
    fireEvent.change(screen.getByTestId("dashboard-status-filter"), {
      target: { value: "posted" },
    });
    fireEvent.change(screen.getByTestId("dashboard-inclusion-filter"), {
      target: { value: "excluded" },
    });

    const pendingExport = screen.getByTestId("dashboard-export-csv");
    await waitFor(() =>
      expect(pendingExport).toHaveAttribute("aria-busy", "true"),
    );
    expect(pendingExport).toHaveAttribute("aria-disabled", "true");
    await waitFor(() => expect(resolveRefresh).toBeTypeOf("function"));

    resolveRefresh(
      new Response(JSON.stringify(refreshed), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-export-csv")).toHaveAttribute(
        "aria-busy",
        "false",
      ),
    );

    const exportLink = screen.getByTestId("dashboard-export-csv");
    const href = new URL(exportLink.getAttribute("href")!, "http://localhost");
    expect(href.pathname).toBe("/api/transactions/export");
    expect(Object.fromEntries(href.searchParams)).toMatchObject({
      scope: "personal",
      period: "month",
      reference: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      accountId: "account-chequing",
      categoryId: "cat-grocery",
      status: "posted",
      inclusion: "excluded",
      search: "green market",
    });
    expect(exportLink).toHaveAccessibleName(/export.*csv|download.*csv/i);
  });
});

describe("GH-12 applied export snapshot regression", () => {
  it("FE-001 disables export throughout debounce/loading and restores the last successful filter snapshot after a rejected refresh", async () => {
    let finishRefresh!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    render(<FinancialDashboard initialModel={initialModel} />);

    const exportControl = screen.getByTestId("dashboard-export-csv");
    const displayedHref = exportControl.getAttribute("href");
    expect(displayedHref).toMatch(/scope=family/);
    expect(displayedHref).not.toContain("search=");

    fireEvent.change(screen.getByTestId("dashboard-search"), {
      target: { value: "rejected private filter" },
    });

    expect(exportControl).toHaveAttribute("aria-disabled", "true");
    expect(exportControl).toHaveAttribute("aria-busy", "true");
    expect(exportControl).not.toHaveAttribute("href");
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    expect(exportControl).toHaveAttribute("aria-disabled", "true");
    expect(exportControl).not.toHaveAttribute("href");

    finishRefresh(
      new Response(JSON.stringify({ error: "Dashboard refresh failed." }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    await screen.findByTestId("dashboard-error");
    await waitFor(() =>
      expect(exportControl).toHaveAttribute("aria-disabled", "false"),
    );
    expect(exportControl).toHaveAttribute("href", displayedHref);
    expect(exportControl.getAttribute("href")).not.toContain(
      "rejected+private+filter",
    );
    expect(exportControl.getAttribute("href")).not.toContain(
      "rejected%20private%20filter",
    );
    expect(screen.getByTestId("dashboard-transaction-list")).toHaveTextContent(
      /green market/i,
    );
  });
});
