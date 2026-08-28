import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
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

describe("GH-51 compact Overview acceptance", () => {
  it("FE-003 leads with month and scope, then exposes every Budget fact under direct section names", () => {
    render(<FinancialDashboard initialModel={familyModel} />);

    const context = screen.getByTestId("dashboard-heading");
    const budget = screen.getByTestId("dashboard-budget-health");
    expect(context).toHaveTextContent(/August 2026/i);
    expect(context).toHaveTextContent(/Family/i);
    expect(context.querySelector("h1")).toBeNull();
    expect(
      context.compareDocumentPosition(budget) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(
      within(budget).getByRole("heading", { name: "Budget" }),
    ).toBeVisible();
    expect(screen.getByTestId("dashboard-budget-spent")).toHaveTextContent(
      /150\.00/,
    );
    expect(screen.getByTestId("dashboard-budget-target")).toHaveTextContent(
      /700\.00/,
    );
    expect(screen.getByTestId("dashboard-budget-remaining")).toHaveTextContent(
      /550\.00/,
    );
    expect(screen.getByTestId("dashboard-budget-pace")).toHaveTextContent(
      /under|below/i,
    );
    expect(screen.getByTestId("dashboard-budget-days")).toHaveTextContent(
      /12.*31|31.*12/,
    );

    expect(
      within(screen.getByTestId("dashboard-account-list")).getByRole(
        "heading",
        {
          name: "Accounts",
        },
      ),
    ).toBeVisible();
    expect(
      within(screen.getByTestId("dashboard-comparison-chart")).getByRole(
        "heading",
        { name: "Spending history" },
      ),
    ).toBeVisible();

    expect(document.body).not.toHaveTextContent(
      /Financial field note|at a glance|working margin|Cumulative field trace|Balance observations/i,
    );
  });

  it("FE-004 keeps narrow Budget, Accounts, Spending history DOM order and declares the reversed wide two-column order", () => {
    render(<FinancialDashboard initialModel={familyModel} />);

    const budget = screen.getByTestId("dashboard-budget-health");
    const accounts = screen.getByTestId("dashboard-account-list");
    const spending = screen.getByTestId("dashboard-comparison-chart");
    expect(
      budget.compareDocumentPosition(accounts) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      accounts.compareDocumentPosition(spending) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const lowerGrid = accounts.parentElement;
    expect(lowerGrid).toBe(spending.parentElement);
    expect(lowerGrid?.className).toMatch(/lg:grid-cols/);
    expect(spending.className).toMatch(
      /lg:(?:order-first|order-1|col-start-1)/,
    );
    expect(accounts.className).toMatch(/lg:(?:order-last|order-2|col-start-2)/);
  });

  it("FE-005 keeps the chart visible and uses one native daily-values disclosure with a complete semantic table", () => {
    render(<FinancialDashboard initialModel={familyModel} />);

    expect(screen.getByTestId("dashboard-comparison-chart")).toBeVisible();
    const disclosure = screen.getByTestId(
      "dashboard-daily-values-disclosure",
    ) as HTMLDetailsElement;
    expect(disclosure.tagName).toBe("DETAILS");
    const summary = within(disclosure).getByText("View daily values", {
      selector: "summary",
    });
    expect(disclosure.open).toBe(false);
    fireEvent.click(summary);
    expect(disclosure.open).toBe(true);
    fireEvent.click(summary);
    expect(disclosure.open).toBe(false);
    fireEvent.click(summary);
    expect(disclosure.open).toBe(true);

    const tables = screen.getAllByTestId("dashboard-comparison-table");
    expect(tables).toHaveLength(1);
    const table = within(tables[0]!);
    expect(
      table.getByText(/daily current cumulative spending/i, {
        selector: "caption",
      }),
    ).toBeInTheDocument();
    expect(table.getByRole("columnheader", { name: "Day" })).toBeVisible();
    expect(table.getByRole("columnheader", { name: "Current" })).toBeVisible();
    expect(table.getByRole("columnheader", { name: "Baseline" })).toBeVisible();
    expect(table.getAllByRole("rowheader")).toHaveLength(
      familyModel.comparison.points.length,
    );
    expect(table.getAllByRole("row")).toHaveLength(
      familyModel.comparison.points.length + 1,
    );
    expect(tables[0]).toHaveTextContent(/50\.00/);
    expect(tables[0]).toHaveTextContent(/60\.00/);
  });
});

function setDashboardViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  fireEvent(window, new Event("resize"));
}

function mockComparisonPlotBounds() {
  const plot = screen.getByTestId("dashboard-comparison-plot");
  vi.spyOn(plot, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 640,
    bottom: 320,
    width: 640,
    height: 320,
    toJSON: () => ({}),
  });
  return plot;
}

describe("GH-63 spending-history axes and interactive readings", () => {
  it("FE-001 renders titled adaptive axes with endpoint X ticks and horizontal tick-aligned CAD gridlines", () => {
    const multiDayModel: DashboardOverviewReadModel = {
      ...familyModel,
      comparison: {
        ...familyModel.comparison,
        points: Array.from({ length: 12 }, (_, index) => ({
          day: index + 1,
          date: `2026-08-${String(index + 1).padStart(2, "0")}`,
          currentCumulativeCents: (index + 1) * 5_000,
          baselineAverageCents: (index + 1) * 4_500,
        })),
      },
    };
    setDashboardViewport(1280);
    const { rerender } = render(
      <FinancialDashboard initialModel={multiDayModel} />,
    );

    expect(
      screen.getByTestId("dashboard-comparison-x-axis-title"),
    ).toHaveTextContent("Day of month");
    expect(
      screen.getByTestId("dashboard-comparison-y-axis-title"),
    ).toHaveTextContent("Cumulative spending (CAD)");
    let xTicks = screen.getAllByTestId("dashboard-comparison-x-tick");
    expect(xTicks.length).toBeGreaterThanOrEqual(5);
    expect(xTicks.length).toBeLessThanOrEqual(7);
    expect(xTicks[0]).toHaveTextContent(/^1$/);
    expect(xTicks.at(-1)).toHaveTextContent(/^12$/);

    const yTicks = screen.getAllByTestId("dashboard-comparison-y-tick");
    expect(yTicks.some((tick) => tick.textContent === "$0")).toBe(true);
    expect(
      yTicks.every((tick) =>
        /^-?\$\d+(?:\.\d+)?k?$/.test(tick.textContent ?? ""),
      ),
    ).toBe(true);
    const svg = screen
      .getByTestId("dashboard-comparison-chart")
      .querySelector("svg")!;
    for (const tick of yTicks) {
      const y = tick.getAttribute("y");
      expect(
        [...svg.querySelectorAll("line")].some(
          (line) =>
            line.getAttribute("y1") === y &&
            line.getAttribute("y2") === y &&
            line.getAttribute("x1") !== line.getAttribute("x2"),
        ),
        `expected a horizontal gridline aligned to ${tick.textContent}`,
      ).toBe(true);
    }
    expect(screen.queryByTestId("dashboard-comparison-guide")).toBeNull();
    expect(screen.getByTestId("dashboard-comparison-plot")).toHaveClass(
      "select-none",
    );

    setDashboardViewport(390);
    rerender(<FinancialDashboard initialModel={multiDayModel} />);
    xTicks = screen.getAllByTestId("dashboard-comparison-x-tick");
    expect(xTicks.length).toBeGreaterThanOrEqual(3);
    expect(xTicks.length).toBeLessThanOrEqual(4);
    expect(xTicks[0]).toHaveTextContent(/^1$/);
    expect(xTicks.at(-1)).toHaveTextContent(/^12$/);
  });

  it("FE-002 always includes zero, adds negative rounded ticks only for negative data, and formats thousands compactly", () => {
    const positive = render(<FinancialDashboard initialModel={familyModel} />);
    let labels = screen
      .getAllByTestId("dashboard-comparison-y-tick")
      .map((tick) => tick.textContent ?? "");
    expect(labels).toContain("$0");
    expect(labels.some((label) => label.startsWith("-$"))).toBe(false);

    const negativeModel: DashboardOverviewReadModel = {
      ...familyModel,
      comparison: {
        baselineMonthCount: 3,
        points: [
          {
            day: 1,
            date: "2026-08-01",
            currentCumulativeCents: -125_000,
            baselineAverageCents: -50_000,
          },
          {
            day: 12,
            date: "2026-08-12",
            currentCumulativeCents: 240_000,
            baselineAverageCents: 100_000,
          },
        ],
      },
    };
    positive.rerender(
      <FinancialDashboard key="negative-range" initialModel={negativeModel} />,
    );
    labels = screen
      .getAllByTestId("dashboard-comparison-y-tick")
      .map((tick) => tick.textContent ?? "");
    expect(labels).toContain("$0");
    expect(labels.some((label) => label.startsWith("-$"))).toBe(true);
    expect(labels.some((label) => /k$/.test(label))).toBe(true);
    expect(labels.every((label) => !label.includes("NaN"))).toBe(true);
  });

  it("FE-003 snaps mouse readings to the nearest day, renders neutral details and available markers, then clears on leave", () => {
    render(<FinancialDashboard initialModel={familyModel} />);
    const plot = mockComparisonPlotBounds();

    expect(screen.queryByTestId("dashboard-comparison-tooltip")).toBeNull();
    fireEvent.pointerMove(plot, {
      clientX: 639,
      clientY: 120,
      pointerType: "mouse",
    });

    const tooltip = screen.getByTestId("dashboard-comparison-tooltip");
    expect(tooltip).toHaveTextContent(/Aug(?:ust)? 3,? 2026/i);
    expect(tooltip).toHaveTextContent(/This month[\s\S]*\$50\.00/i);
    expect(tooltip).toHaveTextContent(/Baseline[\s\S]*\$60\.00/i);
    expect(tooltip).toHaveTextContent(/\$10\.00 below baseline/i);
    expect(tooltip).not.toHaveTextContent(/good|bad|red|green/i);
    expect(
      screen.getByTestId("dashboard-comparison-guide"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("dashboard-comparison-active-current-marker"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("dashboard-comparison-active-baseline-marker"),
    ).toBeInTheDocument();

    fireEvent.pointerLeave(plot, { pointerType: "mouse" });
    expect(screen.queryByTestId("dashboard-comparison-tooltip")).toBeNull();
    expect(screen.queryByTestId("dashboard-comparison-guide")).toBeNull();
  });

  it("FE-004 pins and changes touch readings inside the plot and dismisses them on outside pointer interaction", () => {
    render(<FinancialDashboard initialModel={familyModel} />);
    const plot = mockComparisonPlotBounds();

    fireEvent.pointerDown(plot, {
      clientX: 639,
      clientY: 100,
      pointerType: "touch",
    });
    expect(
      screen.getByTestId("dashboard-comparison-tooltip"),
    ).toHaveTextContent(/Aug(?:ust)? 3,? 2026/i);
    fireEvent.pointerLeave(plot, { pointerType: "touch" });
    expect(
      screen.getByTestId("dashboard-comparison-tooltip"),
    ).toBeInTheDocument();

    fireEvent.pointerDown(plot, {
      clientX: 1,
      clientY: 100,
      pointerType: "touch",
    });
    expect(
      screen.getByTestId("dashboard-comparison-tooltip"),
    ).toHaveTextContent(/Aug(?:ust)? 1,? 2026/i);

    fireEvent.pointerDown(document.body, { pointerType: "touch" });
    expect(screen.queryByTestId("dashboard-comparison-tooltip")).toBeNull();
  });

  it("FE-005 supports focus, clamped arrow navigation and Escape while keeping the polite reading synchronized", () => {
    const initialMarkup = renderToStaticMarkup(
      <FinancialDashboard initialModel={familyModel} />,
    );
    expect(initialMarkup).toMatch(
      /<p(?=[^>]*id="dashboard-comparison-reading")[^>]*><\/p>/,
    );

    render(<FinancialDashboard initialModel={familyModel} />);
    const plot = mockComparisonPlotBounds();
    const reading = screen.getByTestId("dashboard-comparison-reading");

    expect(plot).toHaveAttribute("tabindex", "0");
    expect(plot).toHaveAccessibleName(/spending history|inspect/i);
    expect(reading).toHaveAttribute("role", "status");
    expect(reading).toHaveAttribute("aria-live", "polite");
    expect(reading).toHaveTextContent(/^$/);

    fireEvent.focus(plot);
    expect(
      screen.getByTestId("dashboard-comparison-tooltip"),
    ).toBeInTheDocument();
    expect(reading).toHaveTextContent(/Aug(?:ust)? \d{1,2},? 2026/i);
    expect(reading).toHaveTextContent(/\$\d+\.\d{2}/);

    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(reading).toHaveTextContent(/Aug(?:ust)? 1,? 2026/i);
    fireEvent.keyDown(plot, { key: "ArrowDown" });
    expect(reading).toHaveTextContent(/Aug(?:ust)? 1,? 2026/i);
    fireEvent.keyDown(plot, { key: "ArrowRight" });
    expect(reading).toHaveTextContent(/Aug(?:ust)? 2,? 2026/i);
    fireEvent.keyDown(plot, { key: "ArrowUp" });
    expect(reading).toHaveTextContent(/Aug(?:ust)? 3,? 2026/i);
    fireEvent.keyDown(plot, { key: "ArrowUp" });
    expect(reading).toHaveTextContent(/Aug(?:ust)? 3,? 2026/i);

    fireEvent.keyDown(plot, { key: "Escape" });
    expect(screen.queryByTestId("dashboard-comparison-tooltip")).toBeNull();
    expect(reading).toHaveTextContent(/^$/);
  });

  it("FE-006 omits baseline marker and baseline/comparison tooltip rows when the selected point has no baseline", () => {
    const noBaselineModel: DashboardOverviewReadModel = {
      ...familyModel,
      comparison: {
        baselineMonthCount: 0,
        points: familyModel.comparison.points.map((point) => ({
          ...point,
          baselineAverageCents: null,
        })),
      },
    };
    render(<FinancialDashboard initialModel={noBaselineModel} />);
    const plot = mockComparisonPlotBounds();
    fireEvent.pointerMove(plot, {
      clientX: 639,
      clientY: 100,
      pointerType: "mouse",
    });

    const tooltip = screen.getByTestId("dashboard-comparison-tooltip");
    expect(tooltip).toHaveTextContent(/This month[\s\S]*\$50\.00/i);
    expect(tooltip).not.toHaveTextContent(
      /baseline|above|below|at baseline|unavailable/i,
    );
    expect(
      screen.queryByTestId("dashboard-comparison-active-baseline-marker"),
    ).toBeNull();
    expect(
      screen.getByTestId("dashboard-comparison-active-current-marker"),
    ).toBeInTheDocument();
  });

  it("FE-007 keeps one-point axes and static marker meaningful while every interaction snaps safely to that point", () => {
    render(<FinancialDashboard initialModel={personalModel} />);
    const plot = mockComparisonPlotBounds();

    expect(
      screen.getAllByTestId("dashboard-comparison-x-tick").at(-1)!,
    ).toHaveTextContent(/^1$/);
    expect(
      screen
        .getAllByTestId("dashboard-comparison-y-tick")
        .some((tick) => tick.textContent === "$0"),
    ).toBe(true);
    expect(
      screen.getByTestId("dashboard-comparison-current-marker"),
    ).toBeVisible();

    fireEvent.pointerMove(plot, {
      clientX: 400,
      clientY: 180,
      pointerType: "mouse",
    });
    expect(
      screen.getByTestId("dashboard-comparison-tooltip"),
    ).toHaveTextContent(/Aug(?:ust)? 1,? 2026/i);
    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    fireEvent.keyDown(plot, { key: "ArrowRight" });
    expect(
      screen.getByTestId("dashboard-comparison-reading"),
    ).toHaveTextContent(/Aug(?:ust)? 1,? 2026/i);
  });

  it("FE-008 preserves the complete native daily-values disclosure and semantic table after chart interactions", () => {
    render(<FinancialDashboard initialModel={familyModel} />);
    const plot = mockComparisonPlotBounds();
    fireEvent.focus(plot);
    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    fireEvent.keyDown(plot, { key: "Escape" });

    const disclosure = screen.getByTestId(
      "dashboard-daily-values-disclosure",
    ) as HTMLDetailsElement;
    expect(disclosure.tagName).toBe("DETAILS");
    fireEvent.click(
      within(disclosure).getByText("View daily values", {
        selector: "summary",
      }),
    );
    expect(disclosure.open).toBe(true);

    const table = within(screen.getByTestId("dashboard-comparison-table"));
    expect(table.getAllByRole("row")).toHaveLength(
      familyModel.comparison.points.length + 1,
    );
    expect(table.getAllByRole("rowheader")).toHaveLength(
      familyModel.comparison.points.length,
    );
    expect(table.getByRole("columnheader", { name: "Day" })).toBeVisible();
    expect(table.getByRole("columnheader", { name: "Current" })).toBeVisible();
    expect(table.getByRole("columnheader", { name: "Baseline" })).toBeVisible();
    expect(table.getAllByRole("row").at(-1)).toHaveTextContent(/3/);
    expect(table.getAllByRole("row").at(-1)).toHaveTextContent(/50\.00/);
    expect(table.getAllByRole("row").at(-1)).toHaveTextContent(/60\.00/);
  });
});
