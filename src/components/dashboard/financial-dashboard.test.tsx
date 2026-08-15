import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DashboardOverviewReadModel } from "@/lib/dashboard/overview-types";
import { FinancialDashboard } from "./financial-dashboard";

const familyModel: DashboardOverviewReadModel = {
  scope: "family",
  timeZone: "America/Toronto",
  asOfDate: "2026-08-12",
  range: { startDate: "2026-08-01", endDate: "2026-08-12" },
  budgetHealth: {
    hasBudgets: true,
    targetCents: 70_000,
    spentCents: 15_000,
    remainingCents: 55_000,
    progressPercent: (15_000 / 70_000) * 100,
    daysElapsed: 12,
    daysRemaining: 19,
    daysInMonth: 31,
    expectedPercent: (12 / 31) * 100,
    pace: "under",
  },
  comparison: {
    baselineMonthCount: 3,
    points: [
      {
        day: 1,
        date: "2026-08-01",
        currentCumulativeCents: 2_500,
        baselineAverageCents: 3_000,
      },
      {
        day: 2,
        date: "2026-08-02",
        currentCumulativeCents: 2_500,
        baselineAverageCents: 4_000,
      },
      {
        day: 3,
        date: "2026-08-03",
        currentCumulativeCents: 5_000,
        baselineAverageCents: 6_000,
      },
    ],
  },
  accounts: [
    {
      id: "account-chequing",
      name: "Household Chequing",
      mask: "1234",
      subtype: "chequing",
      availableCents: 192_500,
      currentCents: 200_000,
      freshnessAt: "2026-08-12T12:00:00.000Z",
    },
    {
      id: "account-credit",
      name: "Family Credit",
      mask: null,
      subtype: "credit_card",
      availableCents: null,
      currentCents: -4_250,
      freshnessAt: null,
    },
  ],
};

const personalModel: DashboardOverviewReadModel = {
  ...familyModel,
  scope: "personal",
  budgetHealth: {
    ...familyModel.budgetHealth,
    targetCents: 20_000,
    spentCents: 4_200,
    remainingCents: 15_800,
    progressPercent: 21,
  },
  comparison: {
    baselineMonthCount: 1,
    points: [
      {
        day: 1,
        date: "2026-08-01",
        currentCumulativeCents: 4_200,
        baselineAverageCents: 3_900,
      },
    ],
  },
  accounts: [
    {
      id: "account-personal",
      name: "Private Savings",
      mask: "7777",
      subtype: "savings",
      availableCents: 750_000,
      currentCents: 750_000,
      freshnessAt: "2026-08-12T13:00:00.000Z",
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

describe("GH-31 read-only month-to-date financial dashboard", () => {
  it("FE-001 renders a compact three-month Family overview with text-and-shape pace and a complete table fallback", () => {
    render(<FinancialDashboard initialModel={familyModel} />);

    const heading = screen.getByTestId("dashboard-heading");
    expect(heading).toHaveTextContent(/month to date|august|overview/i);
    expect(heading.className).not.toMatch(/text-(?:7|8|9)xl/);

    expect(screen.getByTestId("dashboard-budget-health")).toBeVisible();
    expect(screen.getByTestId("dashboard-budget-spent")).toHaveTextContent(
      /150\.00/,
    );
    expect(screen.getByTestId("dashboard-budget-target")).toHaveTextContent(
      /700\.00/,
    );
    expect(screen.getByTestId("dashboard-budget-remaining")).toHaveTextContent(
      /550\.00/,
    );
    expect(screen.getByTestId("dashboard-budget-days")).toHaveTextContent(
      /12.*31|31.*12/,
    );

    const pace = screen.getByTestId("dashboard-budget-pace");
    expect(pace).toHaveAttribute("data-pace", "under");
    expect(pace).toHaveTextContent(/under|below/i);
    expect(pace.querySelector('[aria-hidden="true"]')).not.toBeNull();

    expect(screen.getByTestId("dashboard-comparison-chart")).toBeVisible();
    expect(screen.getByTestId("dashboard-baseline-note")).toHaveTextContent(
      /3[- ]month|three[- ]month/i,
    );
    const table = within(screen.getByTestId("dashboard-comparison-table"));
    expect(table.getAllByRole("row")).toHaveLength(
      familyModel.comparison.points.length + 1,
    );
    const lastRow = table.getAllByRole("row").at(-1)!;
    expect(lastRow).toHaveTextContent(/3/);
    expect(lastRow).toHaveTextContent(/50\.00/);
    expect(lastRow).toHaveTextContent(/60\.00/);

    const accounts = screen.getByTestId("dashboard-account-list");
    expect(accounts).toHaveTextContent(/household chequing/i);
    expect(accounts).toHaveTextContent(/1234/);
    expect(accounts).toHaveTextContent(/available/i);
    expect(accounts).toHaveTextContent(/current/i);
    expect(accounts).toHaveTextContent(/fresh|updated|as of/i);
  });

  it("FE-002 explains no budgets and no history, labels partial history accurately, and never fabricates null balances", () => {
    const emptyModel: DashboardOverviewReadModel = {
      ...familyModel,
      budgetHealth: {
        ...familyModel.budgetHealth,
        hasBudgets: false,
        targetCents: null,
        spentCents: 8_000,
        remainingCents: null,
        progressPercent: null,
        pace: null,
      },
      comparison: {
        baselineMonthCount: 0,
        points: familyModel.comparison.points.map((point) => ({
          ...point,
          baselineAverageCents: null,
        })),
      },
      accounts: [
        {
          ...familyModel.accounts[1]!,
          availableCents: null,
          currentCents: null,
          freshnessAt: null,
        },
      ],
    };
    const { rerender } = render(
      <FinancialDashboard initialModel={emptyModel} />,
    );

    expect(screen.getByTestId("dashboard-budget-health")).toHaveTextContent(
      /no budget|without a budget/i,
    );
    expect(screen.getByTestId("dashboard-budget-spent")).toHaveTextContent(
      /80\.00/,
    );
    expect(screen.getByTestId("dashboard-budget-pace")).toHaveAttribute(
      "data-pace",
      "unavailable",
    );
    expect(screen.getByTestId("dashboard-baseline-note")).toHaveTextContent(
      /history (?:is )?unavailable|not enough history|no history/i,
    );
    expect(screen.getByTestId("dashboard-account-list")).toHaveTextContent(
      /unavailable/i,
    );
    expect(screen.getByTestId("dashboard-account-list")).toHaveTextContent(
      /freshness unavailable/i,
    );
    expect(screen.getByTestId("dashboard-account-list")).not.toHaveTextContent(
      /\$0\.00/,
    );
    expect(document.body).not.toHaveTextContent(/NaN/);

    rerender(
      <FinancialDashboard
        key="partial-history"
        initialModel={{
          ...familyModel,
          comparison: { ...familyModel.comparison, baselineMonthCount: 2 },
        }}
      />,
    );
    expect(screen.getByTestId("dashboard-baseline-note")).toHaveTextContent(
      /2 months|two months/i,
    );
    expect(screen.getByTestId("dashboard-baseline-note")).not.toHaveTextContent(
      /three[- ]month|3[- ]month/i,
    );
  });

  it("FE-003 refreshes only the Personal overview, atomically replaces every region, and uses the on-accent token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => response(personalModel));
    render(<FinancialDashboard initialModel={familyModel} />);

    const loading = screen.getByTestId("dashboard-loading");
    expect(loading).toHaveAttribute("role", "status");
    expect(loading).toHaveTextContent(/^$/);
    expect(
      screen.queryByRole("button", { name: /combined/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("dashboard-scope-personal"));

    await waitFor(() =>
      expect(screen.getByTestId("dashboard-scope-personal")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/dashboard/overview?scope=personal",
    );
    expect(screen.getByTestId("dashboard-scope-personal").className).toMatch(
      /bg-brand/,
    );
    expect(screen.getByTestId("dashboard-scope-personal").className).toMatch(
      /text-on-accent/,
    );
    expect(screen.getByTestId("dashboard-budget-spent")).toHaveTextContent(
      /42\.00/,
    );
    expect(screen.getByTestId("dashboard-comparison-table")).toHaveTextContent(
      /39\.00/,
    );

    const onePointChart = within(
      screen.getByTestId("dashboard-comparison-chart"),
    );
    const currentMarkers = onePointChart.getAllByTestId(
      "dashboard-comparison-current-marker",
    );
    const baselineMarkers = onePointChart.getAllByTestId(
      "dashboard-comparison-baseline-marker",
    );
    expect(personalModel.comparison.points).toHaveLength(1);
    expect(currentMarkers).toHaveLength(1);
    expect(currentMarkers[0]).toBeVisible();
    expect(baselineMarkers).toHaveLength(1);
    expect(baselineMarkers[0]).toBeVisible();

    expect(screen.getByTestId("dashboard-account-list")).toHaveTextContent(
      /private savings/i,
    );
    expect(screen.getByTestId("dashboard-account-list")).not.toHaveTextContent(
      /household chequing/i,
    );
  });

  it("FE-004 announces a failed scope refresh while retaining the last successful overview", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      response(
        {
          error: "Dashboard unavailable.",
        },
        503,
      ),
    );
    render(<FinancialDashboard initialModel={familyModel} />);

    fireEvent.click(screen.getByTestId("dashboard-scope-personal"));

    const error = await screen.findByTestId("dashboard-error");
    expect(error).toHaveTextContent(/dashboard unavailable|retained/i);
    expect(error).toHaveAttribute("role", "alert");
    expect(error).not.toHaveTextContent(/postgres|password|secret/i);
    expect(screen.getByTestId("dashboard-scope-family")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("dashboard-budget-spent")).toHaveTextContent(
      /150\.00/,
    );
    expect(screen.getByTestId("dashboard-comparison-table")).toHaveTextContent(
      /60\.00/,
    );
    expect(screen.getByTestId("dashboard-account-list")).toHaveTextContent(
      /household chequing/i,
    );
    expect(screen.getByTestId("dashboard-scope-personal")).toBeEnabled();
  });

  it("FE-005 exposes only the read-only overview surface and preserves intended UTF-8 separators", () => {
    render(<FinancialDashboard initialModel={familyModel} />);

    expect(screen.getAllByRole("button")).toHaveLength(2);
    for (const obsoleteId of [
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
      "dashboard-export-csv",
      "dashboard-category-list",
      "dashboard-budget-list",
      "dashboard-transaction-list",
    ]) {
      expect(screen.queryByTestId(obsoleteId)).not.toBeInTheDocument();
    }

    const surface = document.body.textContent ?? "";
    expect(surface).toMatch(/[·—]/);
    expect(surface).not.toContain("Â·");
    expect(surface).not.toContain("â€”");
  });
});
