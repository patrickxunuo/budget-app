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

const { pushSpy, replaceSpy } = vi.hoisted(() => ({
  pushSpy: vi.fn(),
  replaceSpy: vi.fn(),
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
  useSearchParams: () => new URLSearchParams(),
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
