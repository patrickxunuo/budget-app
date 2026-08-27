import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DashboardReadModel,
  DashboardTransaction,
} from "@/lib/dashboard/types";
import type { ExplorerFilters } from "@/lib/transactions/explorer-filters";

import { TransactionExplorer } from "./transaction-explorer";

/**
 * GH-30 COMP-001..COMP-012.
 *
 * `next/navigation` is mocked because scope selection is a real navigation
 * rather than a client fetch (contract rule 3); `useTransition` is the real
 * React hook. `fetch` is spied per test the way `financial-dashboard.test.tsx`
 * does it, and the 120 ms search debounce is handled with `waitFor` on real
 * timers — the same approach that file uses — rather than fake timers.
 */

const { pushSpy, replaceSpy, searchParamsSpy } = vi.hoisted(() => ({
  pushSpy: vi.fn(),
  replaceSpy: vi.fn(),
  searchParamsSpy: vi.fn(() => new URLSearchParams()),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushSpy,
    replace: replaceSpy,
    prefetch: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => "/transactions",
  useSearchParams: searchParamsSpy,
}));

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const CATEGORY_ID = "22222222-2222-4222-8222-222222222222";

const pendingRow: DashboardTransaction = {
  id: "plaid-pending",
  source: "plaid",
  scope: "family",
  accountId: ACCOUNT_ID,
  accountName: "Household Chequing",
  merchantOrDescription: "Green Market",
  category: { id: CATEGORY_ID, name: "Groceries", color: "#18745b" },
  amountCents: -2500,
  date: "2026-08-12",
  pending: true,
  kind: "spending",
  excluded: false,
};

const refundRow: DashboardTransaction = {
  id: "manual-refund",
  source: "manual",
  scope: "family",
  accountId: null,
  accountName: null,
  merchantOrDescription: "Market refund",
  category: { id: CATEGORY_ID, name: "Groceries", color: "#18745b" },
  amountCents: 500,
  date: "2026-08-12",
  pending: false,
  kind: "refund",
  excluded: false,
};

const excludedTransferRow: DashboardTransaction = {
  id: "excluded-transfer",
  source: "plaid",
  scope: "family",
  accountId: ACCOUNT_ID,
  accountName: "Household Chequing",
  merchantOrDescription: "Card payment",
  category: null,
  amountCents: -50000,
  date: "2026-08-10",
  pending: false,
  kind: "transfer",
  excluded: true,
};

/**
 * `summary.spendingCents` is 13750 ($137.50) while the three rendered rows only
 * account for 2500 ($25.00) of spending. The mismatch is deliberate: it is what
 * lets COMP-003 prove the totals are read from `summary` — the complete
 * filtered set computed before the inclusion filter and the display limit —
 * rather than summed from the rows on screen.
 */
const initialModel: DashboardReadModel = {
  scope: "family",
  period: "month",
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
      id: CATEGORY_ID,
      name: "Groceries",
      color: "#18745b",
      spendingCents: 13750,
      budgetCents: 10000,
      progressPercent: 137.5,
    },
  ],
  accounts: [
    {
      id: ACCOUNT_ID,
      name: "Household Chequing",
      mask: "1234",
      subtype: "chequing",
      availableCents: 192500,
      currentCents: 200000,
      freshnessAt: "2026-08-12T12:00:00.000Z",
    },
  ],
  transactions: [pendingRow, refundRow, excludedTransferRow],
  totalTransactionCount: 3,
  nextCursor: null,
  filterOptions: {
    accounts: [{ id: ACCOUNT_ID, name: "Household Chequing" }],
    categories: [{ id: CATEGORY_ID, name: "Groceries" }],
  },
};

function chooseFilter(testId: string, label: string) {
  fireEvent.click(screen.getByTestId(testId));
  fireEvent.click(screen.getByRole("option", { name: label }));
}
const initialFilters: ExplorerFilters = {
  scope: "family",
  period: "month",
  reference: "2026-08-31",
  from: "",
  to: "",
  search: "",
  accountId: "",
  categoryId: "",
  status: "all",
  inclusion: "default",
};

/** One row on screen, a summary that no arithmetic over that row can produce. */
const filteredModel: DashboardReadModel = {
  ...initialModel,
  summary: {
    incomeCents: 500,
    spendingCents: 98765,
    netFlowCents: -98265,
    pendingAmountCents: 2500,
    pendingCount: 1,
    includedCount: 1,
    excludedCount: 0,
  },
  transactions: [pendingRow],
};

const emptyModel: DashboardReadModel = {
  ...initialModel,
  summary: {
    incomeCents: 0,
    spendingCents: 0,
    netFlowCents: 0,
    pendingAmountCents: 0,
    pendingCount: 0,
    includedCount: 0,
    excludedCount: 0,
  },
  trend: [],
  transactions: [],
  totalTransactionCount: 0,
  nextCursor: null,
};

const staleModel: DashboardReadModel = {
  ...initialModel,
  summary: { ...initialModel.summary, spendingCents: 111111 },
  transactions: [
    { ...pendingRow, id: "stale-row", merchantOrDescription: "Stale row" },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function respondWith(body: unknown, status = 200) {
  return Promise.resolve(jsonResponse(body, status));
}

function urlOf(call: readonly unknown[] | undefined): URL {
  expect(call, "expected a request to have been made").toBeDefined();
  return new URL(String((call ?? [])[0]), "http://localhost");
}

function renderExplorer(model: DashboardReadModel = initialModel) {
  return render(
    <TransactionExplorer
      initialModel={model}
      initialFilters={initialFilters}
    />,
  );
}

const exportLink = () => screen.getByTestId("transactions-export-csv");

function exportHref(): URL {
  const href = exportLink().getAttribute("href");
  expect(href, "the export link must carry an href").toBeTruthy();
  return new URL(String(href), "http://localhost");
}

/** Result rows only — `transactions-result-list` shares the same prefix. */
const resultRows = () =>
  screen.queryAllByTestId(/^transactions-result-(?!list$)/);

beforeEach(() => {
  vi.restoreAllMocks();
  pushSpy.mockClear();
  replaceSpy.mockClear();
  searchParamsSpy.mockReset();
  searchParamsSpy.mockReturnValue(new URLSearchParams());
});

describe("GH-30 transaction explorer", () => {
  it("COMP-001 renders the seeded model on first paint without fetching", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    renderExplorer();

    expect(screen.getByTestId("transactions-explorer")).toBeInTheDocument();
    for (const id of ["plaid-pending", "manual-refund", "excluded-transfer"]) {
      expect(screen.getByTestId(`transactions-result-${id}`)).toBeVisible();
    }
    expect(screen.getByTestId("transactions-result-list")).toHaveTextContent(
      /green market/i,
    );
    expect(screen.queryByTestId("transactions-empty-state")).toBeNull();
    expect(screen.getByTestId("transactions-summary-income")).toHaveTextContent(
      /3,000\.00/,
    );
    expect(
      screen.getByTestId("transactions-summary-spending"),
    ).toHaveTextContent(/137\.50/);
    expect(screen.getByTestId("transactions-summary-net")).toHaveTextContent(
      /2,862\.50/,
    );
    expect(
      screen.getByTestId("transactions-summary-pending"),
    ).toHaveTextContent(/25\.00.*1|1.*25\.00/);
    expect(screen.getByTestId("transactions-range-label")).toHaveTextContent(
      /aug(?:ust)? 1.*aug(?:ust)? 31|2026-08-01.*2026-08-31/i,
    );

    // Rule 10: the live region is mounted, empty, and only its contents toggle.
    const live = screen.getByTestId("transactions-loading");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live.textContent?.trim()).toBe("");
    // Same rule for the alert: mounted, empty, contents toggle. It is never
    // inserted with its text already present.
    expect(screen.getByTestId("transactions-error").textContent?.trim()).toBe(
      "",
    );

    const href = exportHref();
    expect(href.pathname).toBe("/api/transactions/export");
    expect(Object.fromEntries(href.searchParams)).toMatchObject({
      scope: "family",
      period: "month",
      reference: "2026-08-31",
    });
    for (const key of ["search", "accountId", "categoryId", "from", "to"]) {
      expect(href.searchParams.has(key), `href must omit ${key}`).toBe(false);
    }

    // No mount-time request, including none hiding behind the 120 ms debounce.
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("COMP-002 sends both applied filters and renders the narrowed set", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => respondWith(filteredModel));
    renderExplorer();

    chooseFilter("transactions-status-filter", "Pending");
    chooseFilter("transactions-inclusion-filter", "All lines");

    await waitFor(() => {
      const url = urlOf(fetchMock.mock.calls.at(-1));
      expect(url.pathname).toBe("/api/dashboard");
      expect(url.searchParams.get("status")).toBe("pending");
      expect(url.searchParams.get("inclusion")).toBe("all");
    });
    await waitFor(() =>
      expect(
        screen.queryByTestId("transactions-result-manual-refund"),
      ).toBeNull(),
    );
    expect(
      screen.getByTestId("transactions-result-plaid-pending"),
    ).toBeVisible();
    expect(
      screen.queryByTestId("transactions-result-excluded-transfer"),
    ).toBeNull();
    expect(
      screen.getByTestId("transactions-summary-spending"),
    ).toHaveTextContent(/987\.65/);
  });

  it("COMP-003 reads totals from the summary rather than the rendered rows", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      respondWith(filteredModel),
    );
    renderExplorer();

    // Seeded state already disagrees with the rows: $137.50 over $25.00 of rows.
    expect(
      screen.getByTestId("transactions-summary-spending"),
    ).toHaveTextContent(/137\.50/);

    chooseFilter("transactions-status-filter", "Pending");

    await waitFor(() =>
      expect(
        screen.getByTestId("transactions-summary-spending"),
      ).toHaveTextContent(/987\.65/),
    );
    const rows = resultRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent(/25\.00/);
    expect(
      within(screen.getByTestId("transactions-result-list")).getByTestId(
        "transactions-result-plaid-pending",
      ),
    ).toBeVisible();
    // The one row on screen sums to $25.00; the total must not follow it.
    expect(
      screen.getByTestId("transactions-summary-spending"),
    ).not.toHaveTextContent(/\$25\.00/);
    expect(screen.getByTestId("transactions-summary-income")).toHaveTextContent(
      /5\.00/,
    );
    expect(screen.getByTestId("transactions-summary-net")).toHaveTextContent(
      /982\.65/,
    );
  });

  it("COMP-004 snapshots the export href to exactly the query that produced the rows", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => respondWith(filteredModel));
    renderExplorer();

    chooseFilter("transactions-account-filter", "Household Chequing");
    chooseFilter("transactions-category-filter", "Groceries");
    chooseFilter("transactions-status-filter", "Posted");
    chooseFilter("transactions-inclusion-filter", "Excluded");
    fireEvent.change(screen.getByTestId("transactions-search"), {
      target: { value: " green market " },
    });

    await waitFor(() =>
      expect(
        urlOf(fetchMock.mock.calls.at(-1)).searchParams.get("search"),
      ).toBe("green market"),
    );
    await waitFor(() => {
      const href = exportLink().getAttribute("href");
      expect(
        href,
        "the href must be restored once the refresh settles",
      ).toBeTruthy();
      expect(href).toContain("search=green");
    });

    const href = exportHref();
    expect(href.pathname).toBe("/api/transactions/export");
    expect(Object.fromEntries(href.searchParams)).toEqual({
      scope: "family",
      period: "month",
      reference: "2026-08-31",
      status: "posted",
      inclusion: "excluded",
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_ID,
      search: "green market",
    });
    expect(exportLink()).toHaveAccessibleName(/export.*csv|download.*csv/i);

    // The href describes the displayed rows, so it matches the request that
    // produced them key for key.
    const requested = urlOf(fetchMock.mock.calls.at(-1)).searchParams;
    requested.delete("limit");
    expect(Object.fromEntries(href.searchParams)).toEqual(
      Object.fromEntries(requested),
    );
  });

  it("COMP-005 makes export unavailable with a stated reason while a refresh is in flight", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>(() => {}),
    );
    renderExplorer();

    chooseFilter("transactions-status-filter", "Pending");

    await waitFor(() =>
      expect(exportLink()).toHaveAttribute("aria-disabled", "true"),
    );
    expect(exportLink()).not.toHaveAttribute("href");
    expect(screen.getByTestId("transactions-export-reason")).toHaveTextContent(
      /refresh/i,
    );

    // "Unavailable" also means the click itself is suppressed, not merely that
    // the anchor has nowhere to go.
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    exportLink().dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it("COMP-006 makes export unavailable with a stated reason for an empty result set", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      respondWith(emptyModel),
    );
    renderExplorer();

    chooseFilter("transactions-status-filter", "Posted");

    await waitFor(() =>
      expect(screen.getByTestId("transactions-empty-state")).toBeVisible(),
    );
    await waitFor(() =>
      expect(exportLink()).toHaveAttribute("aria-disabled", "true"),
    );
    expect(exportLink()).not.toHaveAttribute("href");
    expect(screen.getByTestId("transactions-export-reason")).toHaveTextContent(
      /no transactions match/i,
    );
  });

  it("COMP-007 names the active filters in the empty state", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      respondWith(emptyModel),
    );
    renderExplorer();

    chooseFilter("transactions-account-filter", "Household Chequing");
    chooseFilter("transactions-status-filter", "Pending");
    fireEvent.change(screen.getByTestId("transactions-search"), {
      target: { value: "unmatchable" },
    });

    const empty = await screen.findByTestId("transactions-empty-state");
    await waitFor(() => expect(empty).toHaveTextContent(/unmatchable/i));
    expect(empty).toHaveTextContent(/household chequing/i);
    expect(empty).toHaveTextContent(/pending/i);
    // Names, not raw identifiers.
    expect(empty).not.toHaveTextContent(ACCOUNT_ID);
  });

  it("COMP-008 syncs the URL with replaceState instead of navigating", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      respondWith(filteredModel),
    );
    renderExplorer();

    chooseFilter("transactions-status-filter", "Pending");
    fireEvent.change(screen.getByTestId("transactions-search"), {
      target: { value: "green" },
    });

    await waitFor(() => {
      const call = replaceState.mock.calls.at(-1);
      expect(call, "expected history.replaceState to be called").toBeDefined();
      const url = new URL(String(call?.[2]), "http://localhost");
      expect(url.pathname).toBe("/transactions");
      expect(url.searchParams.get("status")).toBe("pending");
      expect(url.searchParams.get("search")).toBe("green");
    });
    // Filter changes are a URL sync, not a navigation.
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it("COMP-009 pushes a scope change with account and category cleared and never offers Combined", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      respondWith(filteredModel),
    );
    renderExplorer();

    chooseFilter("transactions-account-filter", "Household Chequing");
    chooseFilter("transactions-category-filter", "Groceries");
    fireEvent.click(screen.getByTestId("transactions-scope-personal"));

    await waitFor(() => expect(pushSpy).toHaveBeenCalled());
    const url = urlOf(pushSpy.mock.calls.at(-1));
    expect(url.pathname).toBe("/transactions");
    expect(url.searchParams.get("scope")).toBe("personal");
    expect(url.searchParams.has("accountId")).toBe(false);
    expect(url.searchParams.has("categoryId")).toBe(false);

    // Mutually exclusive: assert the values, not merely the presence of the
    // attribute. React renders `aria-pressed="false"` on the unpressed button,
    // so a bare `toHaveAttribute("aria-pressed")` holds no matter what.
    expect(screen.getByTestId("transactions-scope-family")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("transactions-scope-personal")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    for (const role of [
      "button",
      "link",
      "option",
      "radio",
      "tab",
      "checkbox",
      "combobox",
    ] as const) {
      expect(
        screen.queryAllByRole(role, { name: /combined/i }),
        `no ${role} may offer Combined`,
      ).toHaveLength(0);
    }
  });

  it("GH-33 FE-007 / COMP-010 settles shared pending, keeps the retained model, and announces a failed refresh", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      respondWith({ error: "Transactions refresh failed. Try again." }, 503),
    );
    renderExplorer();

    chooseFilter("transactions-status-filter", "Pending");

    // `findByTestId` would NOT wait here: the alert is always mounted and
    // starts empty (contract rule 10), so it resolves on the first query pass
    // and the content assertions would race the refresh. Wait on the content.
    await waitFor(() =>
      expect(screen.getByTestId("transactions-error")).toHaveTextContent(
        /try again|retry/i,
      ),
    );
    const error = screen.getByTestId("transactions-error");
    expect(error).toHaveAttribute("role", "alert");
    // Says which scope's retained data is on screen.
    expect(error).toHaveTextContent(/family/i);
    expect(
      screen.getByTestId("transactions-summary-spending"),
    ).toHaveTextContent(/137\.50/);
    expect(screen.getByTestId("transactions-result-list")).toHaveTextContent(
      /green market/i,
    );
    expect(
      screen.getByTestId("transactions-result-excluded-transfer"),
    ).toBeVisible();
    expect(screen.getByTestId("transactions-scope-family")).toBeEnabled();
    expect(screen.getByTestId("transactions-loading")).toBeEmptyDOMElement();
  });

  it("GH-33 FE-007 / COMP-011 lets the newer response win when a slower earlier one resolves last", async () => {
    const resolvers: Array<(value: Response) => void> = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    renderExplorer();

    chooseFilter("transactions-status-filter", "Pending");
    await waitFor(() => expect(resolvers).toHaveLength(1));
    chooseFilter("transactions-inclusion-filter", "All lines");
    await waitFor(() => expect(resolvers).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The newer request answers first.
    await act(async () => {
      resolvers[1]!(jsonResponse(filteredModel));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("transactions-summary-spending"),
      ).toHaveTextContent(/987\.65/),
    );

    // The slow earlier request answers afterwards and must be discarded.
    await act(async () => {
      resolvers[0]!(jsonResponse(staleModel));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(
      screen.getByTestId("transactions-summary-spending"),
    ).toHaveTextContent(/987\.65/);
    expect(
      screen.getByTestId("transactions-summary-spending"),
    ).not.toHaveTextContent(/1,111\.11/);
    expect(screen.queryByTestId("transactions-result-stale-row")).toBeNull();
    expect(
      screen.getByTestId("transactions-result-plaid-pending"),
    ).toBeVisible();
    expect(screen.getByTestId("transactions-loading").textContent?.trim()).toBe(
      "",
    );
  });

  it("COMP-012 gives every control an accessible name", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      respondWith(initialModel),
    );
    renderExplorer();

    for (const id of [
      "transactions-scope-family",
      "transactions-scope-personal",
      "transactions-period-day",
      "transactions-period-week",
      "transactions-period-month",
      "transactions-period-custom",
      "transactions-previous-period",
      "transactions-next-period",
      "transactions-search",
      "transactions-account-filter",
      "transactions-category-filter",
      "transactions-status-filter",
      "transactions-inclusion-filter",
    ]) {
      const control = screen.getByTestId(id);
      expect(
        control,
        `${id} must have an accessible name`,
      ).toHaveAccessibleName(/\S/);
    }
    expect(exportLink()).toHaveAccessibleName(/\S/);

    fireEvent.click(screen.getByTestId("transactions-period-custom"));
    for (const id of [
      "transactions-custom-from",
      "transactions-custom-to",
      "transactions-custom-apply",
    ]) {
      expect(
        screen.getByTestId(id),
        `${id} must have an accessible name`,
      ).toHaveAccessibleName(/\S/);
    }
  });

  /**
   * Contract items 6 and 7 together: the href is a snapshot of the query that
   * produced the rows on screen, so a rejected refresh must leave it describing
   * the last view the server actually answered. Without this, a failed refresh
   * would offer a download of the filters the user typed rather than of the
   * ledger they are looking at. `financial-dashboard.test.tsx` carries the same
   * regression for the dashboard; it is the reason that one exists.
   */
  it("COMP-013 restores the last successful export snapshot after a rejected refresh", async () => {
    let rejectRefresh!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          rejectRefresh = resolve;
        }),
    );
    renderExplorer();

    const settledHref = exportHref();
    expect(settledHref.pathname).toBe("/api/transactions/export");
    expect(settledHref.searchParams.get("scope")).toBe("family");
    expect(settledHref.searchParams.get("search")).toBeNull();

    fireEvent.change(screen.getByTestId("transactions-search"), {
      target: { value: "rejected private filter" },
    });

    // Unavailable for the whole in-flight window, never a stale download.
    await waitFor(() =>
      expect(exportLink()).toHaveAttribute("aria-disabled", "true"),
    );
    expect(exportLink()).not.toHaveAttribute("href");
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));

    rejectRefresh(
      jsonResponse({ error: "The filtered view could not be refreshed." }, 503),
    );

    await waitFor(() =>
      expect(screen.getByTestId("transactions-error")).toHaveTextContent(
        /try again/i,
      ),
    );
    await waitFor(() =>
      expect(exportLink()).not.toHaveAttribute("aria-disabled"),
    );
    expect(exportHref().toString()).toBe(settledHref.toString());
    expect(exportLink().getAttribute("href")).not.toMatch(/rejected/);
    // The retained rows are still the ones the snapshot describes.
    expect(screen.getByTestId("transactions-result-list")).toHaveTextContent(
      /green market/i,
    );
  });

  /**
   * A scope selection unmounts this component — the page keys it on the applied
   * query — and an in-flight request cannot be cancelled once its debounce timer
   * has fired. The request-id guard cannot catch that on its own: the ref it
   * compares against belongs to the unmounted instance, so it still matches.
   * Without the cleanup flag, a late response rewrites the address bar back to
   * the view the member just left, so the URL names one ledger while another is
   * on screen. In a product whose whole contract is "the URL reproduces the
   * view", that is the failure worth a dedicated regression.
   */
  it("GH-33 FE-007 / COMP-014 does not rewrite the address bar from a response that lands after unmount", async () => {
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    let landResponse!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          landResponse = resolve;
        }),
    );
    const { unmount } = renderExplorer();

    chooseFilter("transactions-status-filter", "Pending");
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    expect(replaceStateSpy).not.toHaveBeenCalled();

    unmount();
    await act(async () => {
      landResponse(jsonResponse(filteredModel));
      await Promise.resolve();
    });

    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  /**
   * The empty state explains why nothing is on screen, so it has to name the
   * filters the *rendered* rows were produced by. After a rejected refresh the
   * live controls and the retained model disagree, and naming the controls
   * would blame a filter that was never applied to anything.
   */
  it("COMP-015 names the retained filters, not the rejected ones, after a failed refresh", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    // First refresh succeeds and lands an empty set filtered to Pending.
    fetchMock.mockImplementationOnce(() =>
      respondWith({ ...emptyModel, summary: { ...emptyModel.summary } }),
    );
    renderExplorer();

    chooseFilter("transactions-status-filter", "Pending");
    const empty = await screen.findByTestId("transactions-empty-state");
    await waitFor(() => expect(empty).toHaveTextContent(/pending/i));

    // Second refresh is rejected while the member is switching to Posted.
    fetchMock.mockImplementationOnce(() => respondWith({ error: "nope" }, 503));
    chooseFilter("transactions-status-filter", "Posted");
    await waitFor(() =>
      expect(screen.getByTestId("transactions-error")).toHaveTextContent(
        /try again/i,
      ),
    );

    // The rows are still the Pending ones, so the reason must still say Pending.
    expect(screen.getByTestId("transactions-empty-state")).toHaveTextContent(
      /pending/i,
    );
    expect(
      screen.getByTestId("transactions-empty-state"),
    ).not.toHaveTextContent(/posted/i);
  });

  /**
   * A hand-typed id, or one belonging to the scope just left, still narrows the
   * request. The control must say so: reading "All accounts" while the set stays
   * filtered is the UI lying about its own state.
   */
  it("COMP-016 reports an account filter whose id has no matching option", async () => {
    const unknownId = "44444444-4444-4444-8444-444444444444";
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      respondWith(emptyModel),
    );
    render(
      <TransactionExplorer
        initialModel={{ ...emptyModel, transactions: [] }}
        initialFilters={{ ...initialFilters, accountId: unknownId }}
      />,
    );

    const account = screen.getByTestId("transactions-account-filter");
    expect(account).toHaveAttribute("data-value", unknownId);
    expect(account).toHaveTextContent(/unavailable account/i);
    // The empty state names the filter without echoing the raw identifier.
    const empty = screen.getByTestId("transactions-empty-state");
    expect(empty).toHaveTextContent(/account/i);
    expect(empty.textContent ?? "").not.toContain(unknownId);
  });

  /**
   * Dates typed into the custom form but never applied must not be resurrected.
   * The touched flag exists to stop a landing response from overwriting what
   * the member is mid-way through typing; before this fix it never cleared, so
   * leaving and re-entering Custom silently applied the abandoned dates.
   */
  it("COMP-017 discards custom dates that were typed but never applied", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      respondWith(initialModel),
    );
    renderExplorer();

    fireEvent.click(screen.getByTestId("transactions-period-custom"));
    fireEvent.change(screen.getByTestId("transactions-custom-from"), {
      target: { value: "1999-01-01" },
    });
    fireEvent.change(screen.getByTestId("transactions-custom-to"), {
      target: { value: "1999-01-31" },
    });

    // Leave without applying, then come back.
    fireEvent.click(screen.getByTestId("transactions-period-month"));
    fireEvent.click(screen.getByTestId("transactions-period-custom"));

    expect(screen.getByTestId("transactions-custom-from")).toHaveValue(
      initialModel.range.startDate,
    );
    expect(screen.getByTestId("transactions-custom-to")).toHaveValue(
      initialModel.range.endDate,
    );
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    for (const call of vi.mocked(globalThis.fetch).mock.calls) {
      expect(String(call[0])).not.toContain("1999-01-01");
    }
  });
});

describe("GH-64 overview export visibility", () => {
  it("FE-006 keeps filtered CSV out of mobile layout and accessibility while retaining the desktop toolbar control", () => {
    renderExplorer();

    const exportControl = screen.getByTestId("transactions-export-csv");
    expect(exportControl).toHaveClass("hidden");
    expect(
      exportControl.className
        .split(/\s+/)
        .some((token) => token.startsWith("md:")),
    ).toBe(true);
    expect(exportControl).toHaveAttribute("href");
  });
});

function paginationRow(index: number): DashboardTransaction {
  return {
    ...pendingRow,
    id: `page-row-${String(index).padStart(3, "0")}`,
    merchantOrDescription: `Pagination row ${index}`,
    date: `2026-08-${String(31 - (index % 31)).padStart(2, "0")}`,
    pending: false,
  };
}

function paginationModel(
  start: number,
  count: number,
  nextCursor: string | null,
): DashboardReadModel {
  return {
    ...initialModel,
    transactions: Array.from({ length: count }, (_, offset) =>
      paginationRow(start + offset),
    ),
    totalTransactionCount: 65,
    nextCursor,
    summary: { ...initialModel.summary, includedCount: 65 },
  };
}

function setDesktopMatches(desktop: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: desktop && query === "(min-width: 768px)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("GH-65 progressive transaction pagination", () => {
  it("FE-001 shows 10 of the complete count on mobile with a named 44px reveal target", () => {
    setDesktopMatches(false);
    renderExplorer(paginationModel(0, 50, "cursor-50"));

    expect(resultRows()).toHaveLength(10);
    expect(screen.getByTestId("transactions-visible-count")).toHaveTextContent(
      /10\s+of\s+65\s+transactions/i,
    );
    const showMore = screen.getByTestId("transactions-show-more");
    expect(showMore).toHaveAccessibleName("Show 10 more");
    expect(showMore).toHaveClass("min-h-11");
    expect(
      screen.getByTestId("transactions-pagination-status"),
    ).toHaveAttribute("aria-live", "polite");
    expect(
      screen.getByTestId("transactions-pagination-status"),
    ).toBeEmptyDOMElement();
  });

  it("FE-002 reveals exactly 10 buffered rows without issuing a request", () => {
    setDesktopMatches(false);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    renderExplorer(paginationModel(0, 50, "cursor-50"));

    fireEvent.click(screen.getByTestId("transactions-show-more"));

    expect(resultRows()).toHaveLength(20);
    expect(screen.getByTestId("transactions-visible-count")).toHaveTextContent(
      /20\s+of\s+65/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("FE-003 fetches one cursor page only after exhausting the buffer and appends the next 10 uniquely", async () => {
    setDesktopMatches(false);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => respondWith(paginationModel(50, 15, null)));
    renderExplorer(paginationModel(0, 50, "cursor-50"));
    const showMore = screen.getByTestId("transactions-show-more");

    for (let index = 0; index < 4; index += 1) fireEvent.click(showMore);
    expect(resultRows()).toHaveLength(50);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(showMore);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const continuation = urlOf(fetchMock.mock.calls[0]);
    expect(continuation.pathname).toBe("/api/dashboard");
    expect(continuation.searchParams.get("cursor")).toBe("cursor-50");
    expect(continuation.searchParams.get("limit")).toBe("50");
    await waitFor(() => expect(resultRows()).toHaveLength(60));
    expect(new Set(resultRows().map((item) => item.dataset.testid)).size).toBe(
      60,
    );
  });

  it("FE-004 hydrates desktop to the full 50-row server buffer while retaining complete totals", async () => {
    setDesktopMatches(true);
    renderExplorer(paginationModel(0, 50, "cursor-50"));

    await waitFor(() => expect(resultRows()).toHaveLength(50));
    expect(screen.getByTestId("transactions-visible-count")).toHaveTextContent(
      /50\s+of\s+65/i,
    );
    expect(
      screen.getByTestId("transactions-summary-spending"),
    ).toHaveTextContent(/137\.50/);
  });

  it("FE-005 replaces expanded pages and restores mobile depth when a result filter changes", async () => {
    setDesktopMatches(false);
    const refreshed = {
      ...paginationModel(100, 22, null),
      totalTransactionCount: 22,
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => respondWith(refreshed));
    renderExplorer(paginationModel(0, 50, "cursor-50"));
    fireEvent.click(screen.getByTestId("transactions-show-more"));
    expect(resultRows()).toHaveLength(20);

    chooseFilter("transactions-status-filter", "Pending");

    await waitFor(() =>
      expect(
        screen.getByTestId("transactions-visible-count"),
      ).toHaveTextContent(/10\s+of\s+22/i),
    );
    expect(resultRows()).toHaveLength(10);
    expect(screen.queryByTestId("transactions-result-page-row-000")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(fetchMock.mock.calls[0]).searchParams.has("cursor")).toBe(
      false,
    );
    expect(screen.queryByTestId("transactions-pagination-retry")).toBeNull();
  });

  it("FE-006 discards an older continuation after a newer filter response replaces the view", async () => {
    setDesktopMatches(false);
    const resolvers: Array<(response: Response) => void> = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    renderExplorer(paginationModel(0, 10, "cursor-10"));

    fireEvent.click(screen.getByTestId("transactions-show-more"));
    await waitFor(() => expect(resolvers).toHaveLength(1));
    chooseFilter("transactions-status-filter", "Pending");
    await waitFor(() => expect(resolvers).toHaveLength(2));

    await act(async () => {
      resolvers[1]!(
        jsonResponse({
          ...paginationModel(100, 12, null),
          totalTransactionCount: 12,
        }),
      );
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("transactions-visible-count"),
      ).toHaveTextContent(/10\s+of\s+12/i),
    );

    await act(async () => {
      resolvers[0]!(jsonResponse(paginationModel(10, 10, null)));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByTestId("transactions-result-page-row-010")).toBeNull();
    expect(
      screen.getByTestId("transactions-result-page-row-100"),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("FE-008 retains loaded order after continuation failure and retry recovers with the same cursor", async () => {
    setDesktopMatches(false);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        respondWith({ error: "Continuation unavailable." }, 503),
      )
      .mockImplementationOnce(() => respondWith(paginationModel(10, 10, null)));
    renderExplorer(paginationModel(0, 10, "cursor-10"));
    const originalOrder = resultRows().map((item) => item.dataset.testid);

    fireEvent.click(screen.getByTestId("transactions-show-more"));
    await waitFor(() =>
      expect(
        screen.getByTestId("transactions-pagination-error"),
      ).toHaveTextContent(/continuation unavailable|try again/i),
    );
    expect(resultRows().map((item) => item.dataset.testid)).toEqual(
      originalOrder,
    );
    expect(
      screen.getByTestId("transactions-pagination-retry"),
    ).toHaveAccessibleName(/retry/i);

    fireEvent.click(screen.getByTestId("transactions-pagination-retry"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    for (const call of fetchMock.mock.calls) {
      expect(urlOf(call).searchParams.get("cursor")).toBe("cursor-10");
    }
    await waitFor(() => expect(resultRows()).toHaveLength(20));
    expect(screen.queryByTestId("transactions-pagination-retry")).toBeNull();
    expect(
      screen.getByTestId("transactions-pagination-error"),
    ).toBeEmptyDOMElement();
  });

  it("FE-009 never writes feed depth/cursor into the URL or complete-set CSV href", async () => {
    setDesktopMatches(false);
    const replaceState = vi.spyOn(window.history, "replaceState");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => respondWith(paginationModel(10, 10, null)));
    renderExplorer(paginationModel(0, 10, "cursor-10"));

    fireEvent.click(screen.getByTestId("transactions-show-more"));
    await waitFor(() => expect(resultRows()).toHaveLength(20));

    expect(replaceState).not.toHaveBeenCalled();
    expect(window.location.search).not.toMatch(/cursor|limit|visible|page/i);
    const href = exportHref();
    expect(href.pathname).toBe("/api/transactions/export");
    for (const key of ["cursor", "limit", "visible", "page"]) {
      expect(href.searchParams.has(key), `CSV must omit ${key}`).toBe(false);
    }
    expect(urlOf(fetchMock.mock.calls[0]).searchParams.get("cursor")).toBe(
      "cursor-10",
    );
  });
});

it("GH-65 FE-007 reconciles a historical narrowed surface to current Toronto defaults on plain /transactions", async () => {
  setDesktopMatches(false);
  const expectedTorontoDate = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .map(({ type, value }) => [type, value]),
  );
  const today = `${expectedTorontoDate.year}-${expectedTorontoDate.month}-${expectedTorontoDate.day}`;
  const filtered = {
    ...initialFilters,
    reference: "2020-01-15",
    search: "historical",
    status: "pending" as const,
  };
  searchParamsSpy.mockReturnValue(
    new URLSearchParams(
      "reference=2020-01-15&search=historical&status=pending",
    ),
  );
  const refreshed = {
    ...paginationModel(200, 18, null),
    totalTransactionCount: 18,
  };
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => respondWith(refreshed));
  const view = render(
    <TransactionExplorer
      initialModel={paginationModel(0, 50, "cursor-50")}
      initialFilters={filtered}
    />,
  );
  fireEvent.click(screen.getByTestId("transactions-show-more"));
  expect(resultRows()).toHaveLength(20);

  searchParamsSpy.mockReturnValue(new URLSearchParams());
  view.rerender(
    <TransactionExplorer
      initialModel={paginationModel(0, 50, "cursor-50")}
      initialFilters={filtered}
    />,
  );

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const request = urlOf(fetchMock.mock.calls[0]);
  expect(Object.fromEntries(request.searchParams)).toEqual({
    scope: "family",
    period: "month",
    reference: today,
    status: "all",
    inclusion: "default",
    limit: "50",
  });
  await waitFor(() =>
    expect(screen.getByTestId("transactions-visible-count")).toHaveTextContent(
      "10 of 18 transactions visible",
    ),
  );
  expect(resultRows()).toHaveLength(10);
  expect(screen.queryByTestId("transactions-result-page-row-000")).toBeNull();
  expect(screen.queryByTestId("transactions-pagination-retry")).toBeNull();
});

const GH66_PLAID_ID = "60000000-0000-4000-8000-000000000001";
const GH66_MANUAL_ID = "60000000-0000-4000-8000-000000000002";

const informationFirstModel: DashboardReadModel = {
  ...initialModel,
  transactions: [
    {
      ...pendingRow,
      id: GH66_PLAID_ID,
      date: "2026-08-12",
      merchantOrDescription: "Green Market",
      pending: true,
    },
    {
      ...refundRow,
      id: GH66_MANUAL_ID,
      date: "2026-08-11",
      merchantOrDescription: "Cash adjustment",
      excluded: true,
    },
    {
      ...excludedTransferRow,
      id: "60000000-0000-4000-8000-000000000003",
      date: "2026-08-10",
      merchantOrDescription: "Ordinary posted purchase",
      excluded: false,
      kind: "spending",
    },
  ],
  totalTransactionCount: 3,
};

const plaidDetail = {
  id: GH66_PLAID_ID,
  source: "plaid" as const,
  date: "2026-08-12",
  merchantOrDescription: "Green Market",
  description: "GREEN MARKET TORONTO",
  amountCents: -2500,
  accountName: "Household Chequing",
  scope: "family" as const,
  state: "pending" as const,
  kind: "spending" as const,
  originalCategory: {
    primary: "FOOD_AND_DRINK",
    detailed: "FOOD_AND_DRINK_GROCERIES",
  },
  effectiveCategory: "Groceries",
  excluded: false,
  notes: "Weekly food shop",
};

function appearsBefore(first: HTMLElement, second: HTMLElement) {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("GH-66 mobile transactions information-first", () => {
  it("FE-001 orders the 390px information hierarchy, keeps four compact totals, and exposes 44px targets", () => {
    setDesktopMatches(false);
    renderExplorer(informationFirstModel);

    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Transaction activity",
    });
    const range = screen.getByTestId("transactions-range-label");
    const count = screen.getByTestId("transactions-visible-count");
    const scope = screen.getByTestId("transactions-scope-family");
    const income = screen.getByTestId("transactions-summary-income");
    const spending = screen.getByTestId("transactions-summary-spending");
    const net = screen.getByTestId("transactions-summary-net");
    const pending = screen.getByTestId("transactions-summary-pending");
    const period = screen.getByTestId("transactions-period-month");
    const search = screen.getByTestId("transactions-search");
    const filters = screen.getByTestId("transactions-filters-trigger");
    const feed = screen.getByTestId("transactions-result-list");

    expect(appearsBefore(heading, range)).toBe(true);
    expect(appearsBefore(range, count)).toBe(true);
    expect(appearsBefore(count, scope)).toBe(true);
    expect(appearsBefore(scope, income)).toBe(true);
    expect(appearsBefore(pending, period)).toBe(true);
    expect(appearsBefore(period, search)).toBe(true);
    expect(appearsBefore(filters, feed)).toBe(true);
    for (const total of [income, spending, net, pending])
      expect(total).toBeVisible();
    expect(income.parentElement?.parentElement).toHaveClass("grid-cols-2");
    const firstRow = screen.getByTestId(`transactions-result-${GH66_PLAID_ID}`);
    for (const content of [
      within(firstRow).getByText("Green Market"),
      within(firstRow).getByText(/Household Chequing.*Groceries/i),
    ]) {
      expect(content).not.toHaveClass("truncate");
      expect(content.className).toMatch(/whitespace-normal|break-words/);
    }
    for (const target of [scope, period, search, filters, ...resultRows()]) {
      expect(target.className).toMatch(/min-h-(?:11|14)/);
    }
  });

  it("FE-002 opens a labelled mobile filter modal, operates advanced/custom fields, traps focus, closes on Escape, and restores trigger focus", async () => {
    setDesktopMatches(false);
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      respondWith(informationFirstModel),
    );
    renderExplorer(informationFirstModel);
    const trigger = screen.getByTestId("transactions-filters-trigger");

    fireEvent.click(screen.getByTestId("transactions-period-custom"));
    fireEvent.click(trigger);
    const sheet = screen.getByTestId("transactions-filter-sheet");
    expect(sheet).toHaveAttribute("role", "dialog");
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(sheet).toHaveAccessibleName(/filters/i);
    expect(
      within(sheet).getByTestId("transactions-account-filter"),
    ).toBeVisible();
    expect(
      within(sheet).getByTestId("transactions-category-filter"),
    ).toBeVisible();
    expect(
      within(sheet).getByTestId("transactions-status-filter"),
    ).toBeVisible();
    expect(
      within(sheet).getByTestId("transactions-inclusion-filter"),
    ).toBeVisible();
    fireEvent.change(within(sheet).getByTestId("transactions-custom-from"), {
      target: { value: "2026-08-01" },
    });
    fireEvent.change(within(sheet).getByTestId("transactions-custom-to"), {
      target: { value: "2026-08-12" },
    });
    expect(screen.getByTestId("transactions-filter-count")).toHaveTextContent(
      /1|2/,
    );

    const close = within(sheet).getByTestId("transactions-filter-close");
    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(sheet).toContainElement(document.activeElement as HTMLElement);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("transactions-filter-sheet")).toBeNull(),
    );
    expect(trigger).toHaveFocus();
  });

  it("FE-003 removes chips through the controller, resets mobile reveal depth, commits only successful URL state, and retains rows on failure", async () => {
    setDesktopMatches(false);
    const replaceState = vi.spyOn(window.history, "replaceState");
    const expanded = paginationModel(0, 25, null);
    const narrowed = {
      ...expanded,
      transactions: expanded.transactions.slice(0, 18),
      totalTransactionCount: 18,
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => respondWith(narrowed));
    renderExplorer(expanded);
    fireEvent.click(screen.getByTestId("transactions-show-more"));
    expect(resultRows()).toHaveLength(20);

    fireEvent.click(screen.getByTestId("transactions-filters-trigger"));
    chooseFilter("transactions-status-filter", "Pending");
    await waitFor(() => expect(resultRows()).toHaveLength(10));
    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    expect(
      new URL(
        String(replaceState.mock.calls.at(-1)?.[2]),
        "http://localhost",
      ).searchParams.get("status"),
    ).toBe("pending");
    expect(screen.getByTestId("transactions-filter-chips")).toHaveTextContent(
      /pending/i,
    );

    const retained = resultRows().map((row) => row.dataset.testid);
    fetchMock.mockImplementationOnce(() =>
      respondWith({ error: "Refresh failed." }, 503),
    );
    fireEvent.click(screen.getByTestId("transactions-filter-chip-status"));
    await waitFor(() =>
      expect(screen.getByTestId("transactions-error")).toHaveTextContent(
        /try again|failed/i,
      ),
    );
    expect(resultRows().map((row) => row.dataset.testid)).toEqual(retained);
    expect(
      new URL(
        String(replaceState.mock.calls.at(-1)?.[2]),
        "http://localhost",
      ).searchParams.get("status"),
    ).toBe("pending");
  });

  it("FE-004 groups the mixed feed by date with a dense two-line hierarchy and only exceptional badges", () => {
    setDesktopMatches(false);
    renderExplorer(informationFirstModel);

    for (const date of ["2026-08-12", "2026-08-11", "2026-08-10"]) {
      const heading = screen.getByTestId(`transactions-date-group-${date}`);
      expect(heading).toBeVisible();
      expect(heading.tagName).toMatch(/^H[2-6]$/);
      expect(heading.closest("button,details,summary")).toBeNull();
    }
    const plaid = screen.getByTestId(`transactions-result-${GH66_PLAID_ID}`);
    expect(plaid).toHaveTextContent(/green market.*25\.00/i);
    expect(plaid).toHaveTextContent(/household chequing.*groceries/i);
    expect(plaid).toHaveTextContent(/pending/i);
    expect(plaid).not.toHaveTextContent(
      /family privacy|plaid|spending|2026-08-12/i,
    );
    const manual = screen.getByTestId(`transactions-result-${GH66_MANUAL_ID}`);
    expect(manual).toHaveTextContent(/manual/i);
    expect(manual).toHaveTextContent(/excluded/i);
    const ordinary = screen.getByTestId(
      "transactions-result-60000000-0000-4000-8000-000000000003",
    );
    expect(ordinary).not.toHaveTextContent(
      /family privacy|plaid|spending|2026-08-10/i,
    );
  });

  it("FE-005 opens source-aware read-only detail, replaces the skeleton with all metadata, and restores focus and scroll on close", async () => {
    setDesktopMatches(false);
    let resolveDetail!: (response: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveDetail = resolve;
        }),
    );
    const scrollTo = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined);
    renderExplorer(informationFirstModel);
    const row = screen.getByTestId(`transactions-result-${GH66_PLAID_ID}`);
    row.focus();
    fireEvent.click(row);

    const sheet = screen.getByTestId("transaction-detail-sheet");
    expect(sheet).toHaveAttribute("role", "dialog");
    expect(screen.getByTestId("transaction-detail-loading")).toBeVisible();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `/api/transactions/detail/plaid/${GH66_PLAID_ID}`,
    );
    expect(document.body.style.overflow).toBe("hidden");

    await act(async () => {
      resolveDetail(jsonResponse({ transaction: plaidDetail }));
      await Promise.resolve();
    });
    const metadata = await screen.findByTestId("transaction-detail-metadata");
    expect(sheet).toHaveTextContent(/Green Market/i);
    for (const text of [
      "GREEN MARKET TORONTO",
      "Household Chequing",
      "FOOD_AND_DRINK",
      "Groceries",
      "Weekly food shop",
      "Pending",
      "Family",
    ]) {
      expect(metadata).toHaveTextContent(new RegExp(text, "i"));
    }
    expect(
      within(sheet).queryByRole("button", {
        name: /edit|delete|categor|export|manage/i,
      }),
    ).toBeNull();
    fireEvent.click(screen.getByTestId("transaction-detail-close"));
    await waitFor(() =>
      expect(screen.queryByTestId("transaction-detail-sheet")).toBeNull(),
    );
    expect(row).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("FE-006 contains detail failure, retries the same source/id successfully, and leaves the feed usable after close", async () => {
    setDesktopMatches(false);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        respondWith({ error: "Detail unavailable." }, 503),
      )
      .mockImplementationOnce(() => respondWith({ transaction: plaidDetail }));
    renderExplorer(informationFirstModel);
    fireEvent.click(screen.getByTestId(`transactions-result-${GH66_PLAID_ID}`));

    await waitFor(() =>
      expect(screen.getByTestId("transaction-detail-error")).toHaveTextContent(
        /try again|unavailable/i,
      ),
    );
    expect(screen.getByTestId("transactions-result-list")).toBeVisible();
    fireEvent.click(screen.getByTestId("transaction-detail-retry"));
    await screen.findByTestId("transaction-detail-metadata");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls)
      expect(String(call[0])).toBe(
        `/api/transactions/detail/plaid/${GH66_PLAID_ID}`,
      );
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("transaction-detail-sheet")).toBeNull(),
    );
    expect(
      screen.getByTestId(`transactions-result-${GH66_MANUAL_ID}`),
    ).toBeEnabled();
  });

  it("FE-007 reveals exactly 10 more mobile rows without resetting scroll and announces the new count", async () => {
    setDesktopMatches(false);
    const scrollTo = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined);
    renderExplorer(paginationModel(0, 25, null));
    fireEvent.click(screen.getByTestId("transactions-show-more"));
    expect(resultRows()).toHaveLength(20);
    await waitFor(() =>
      expect(
        screen.getByTestId("transactions-pagination-status"),
      ).toHaveTextContent(/20.*visible|showing.*20/i),
    );
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("FE-008 keeps the 50-row desktop review surface, inline filters, Manage, and compact CSV export", async () => {
    setDesktopMatches(true);
    renderExplorer(paginationModel(0, 50, null));
    await waitFor(() => expect(resultRows()).toHaveLength(50));
    for (const id of [
      "transactions-account-filter",
      "transactions-category-filter",
      "transactions-status-filter",
      "transactions-inclusion-filter",
    ]) {
      expect(screen.getByTestId(id)).toBeVisible();
    }
    expect(screen.queryByTestId("transactions-filters-trigger")).toBeNull();
    expect(
      within(screen.getByTestId("transactions-manage-menu")).getByText(
        /^Manage$/,
      ),
    ).toBeVisible();
    expect(screen.getByTestId("transactions-export-csv")).toBeVisible();
  });
});

function installMutableDesktopMatchMedia(initialDesktop = false) {
  let desktop = initialDesktop;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    get matches() {
      return desktop;
    },
    media: "(min-width: 768px)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(
      (type: string, listener: (event: MediaQueryListEvent) => void) => {
        if (type === "change") listeners.add(listener);
      },
    ),
    removeEventListener: vi.fn(
      (type: string, listener: (event: MediaQueryListEvent) => void) => {
        if (type === "change") listeners.delete(listener);
      },
    ),
    dispatchEvent: vi.fn(),
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn(() => media),
  });
  return {
    setDesktop(next: boolean) {
      desktop = next;
      const event = {
        matches: next,
        media: media.media,
      } as MediaQueryListEvent;
      for (const listener of listeners) listener(event);
    },
  };
}

describe("GH-66 modal portal and responsive ownership regressions", () => {
  it("FE-002 keeps focus inside the mobile sheet plus its portaled searchable category, and Escape unwinds one layer at a time", async () => {
    setDesktopMatches(false);
    renderExplorer(informationFirstModel);
    const trigger = screen.getByTestId("transactions-filters-trigger");
    fireEvent.click(trigger);
    const sheet = screen.getByTestId("transactions-filter-sheet");
    const category = within(sheet).getByTestId("transactions-category-filter");
    fireEvent.click(category);

    const menu = document.querySelector<HTMLElement>(".piggy-select-menu");
    expect(menu).not.toBeNull();
    const search = within(menu!).getByRole("combobox", {
      name: /search categories/i,
    });
    await waitFor(() => expect(search).toHaveFocus());

    fireEvent.keyDown(search, { key: "Tab" });
    expect(
      sheet.contains(document.activeElement) ||
        menu!.contains(document.activeElement),
    ).toBe(true);
    fireEvent.keyDown(document.activeElement ?? search, {
      key: "Tab",
      shiftKey: true,
    });
    expect(
      sheet.contains(document.activeElement) ||
        menu!.contains(document.activeElement),
    ).toBe(true);

    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() =>
      expect(document.querySelector(".piggy-select-menu")).toBeNull(),
    );
    expect(screen.getByTestId("transactions-filter-sheet")).toBeVisible();
    await waitFor(() => expect(category).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("transactions-filter-sheet")).toBeNull(),
    );
    expect(trigger).toHaveFocus();
  });

  it("FE-008 reveals all inline advanced filters when the viewport changes from mobile to desktop while the sheet is open", async () => {
    const viewport = installMutableDesktopMatchMedia(false);
    renderExplorer(informationFirstModel);
    fireEvent.click(screen.getByTestId("transactions-filters-trigger"));
    expect(screen.getByTestId("transactions-filter-sheet")).toBeVisible();

    act(() => viewport.setDesktop(true));

    const explorer = screen.getByTestId("transactions-explorer");
    for (const id of [
      "transactions-account-filter",
      "transactions-category-filter",
      "transactions-status-filter",
      "transactions-inclusion-filter",
    ]) {
      expect(within(explorer).getByTestId(id)).toBeVisible();
    }
  });
});
