import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";

import { BudgetWorkbench } from "./budget-workbench";

const ids = {
  grocery: "b3000000-0000-4000-8000-000000000001",
  dining: "b3000000-0000-4000-8000-000000000002",
  budget: "b4000000-0000-4000-8000-000000000001",
};
const baseTarget = {
  id: ids.budget,
  categoryId: ids.grocery,
  categoryName: "Groceries",
  categoryColor: "#18745b",
  scope: "family" as const,
  amountCents: 50000,
  currencyCode: "CAD" as const,
  effectiveMonth: "2026-08-01",
  endMonth: null,
  archived: false,
};
const initialModel = {
  scope: "family" as const,
  month: "2026-08-01",
  monthEnd: "2026-08-31",
  currencyCode: "CAD" as const,
  budgets: [
    {
      ...baseTarget,
      spentCents: 37500,
      remainingCents: 12500,
      overBudgetCents: 0,
      percentageUsed: 75,
      status: "watch" as const,
    },
  ],
  availableCategories: [{ id: ids.dining, name: "Dining", color: "#b56b45" }],
  summary: {
    targetCents: 50000,
    spentCents: 37500,
    remainingCents: 12500,
    overBudgetCents: 0,
  },
};
const personalModel = {
  ...initialModel,
  scope: "personal" as const,
  budgets: [],
  summary: {
    targetCents: 0,
    spentCents: 0,
    remainingCents: 0,
    overBudgetCents: 0,
  },
};

function response(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}
function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
function fullModelWith(target: typeof baseTarget, spentCents = 0) {
  const remainingCents = Math.max(target.amountCents - spentCents, 0);
  const overBudgetCents = Math.max(spentCents - target.amountCents, 0);
  return {
    ...initialModel,
    budgets: [
      {
        ...target,
        spentCents,
        remainingCents,
        overBudgetCents,
        percentageUsed: (Math.max(spentCents, 0) / target.amountCents) * 100,
        status:
          spentCents > target.amountCents
            ? ("over" as const)
            : ("on-track" as const),
      },
    ],
    availableCategories: [],
    summary: {
      targetCents: target.amountCents,
      spentCents,
      remainingCents,
      overBudgetCents,
    },
  };
}

function chooseCategory(label: string) {
  fireEvent.click(screen.getByTestId("budget-category"));
  fireEvent.click(screen.getByRole("option", { name: new RegExp(label, "i") }));
}
beforeEach(() => vi.restoreAllMocks());

describe("GH-10 monthly budget workbench acceptance", () => {
  it("FE-001 switches explicit scope/month and creates a CAD target with one atomic model replacement", async () => {
    const created = {
      ...baseTarget,
      id: "b4000000-0000-4000-8000-000000000002",
      categoryId: ids.dining,
      categoryName: "Dining",
      amountCents: 25000,
    };
    const septemberModel = {
      ...initialModel,
      month: "2026-09-01",
      monthEnd: "2026-09-30",
    };
    const createdModel = {
      ...fullModelWith(created, 5000),
      month: "2026-09-01",
      monthEnd: "2026-09-30",
    };
    let createdSuccessfully = false;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = String(input);
        if (init?.method === "POST") {
          createdSuccessfully = true;
          return response({ budget: created }, 201);
        }
        if (url.includes("scope=personal")) return response(personalModel);
        if (url.includes("month=2026-09-01")) {
          return response(createdSuccessfully ? createdModel : septemberModel);
        }
        return response(initialModel);
      });

    render(<BudgetWorkbench initialModel={initialModel} />);
    expect(screen.getByTestId("budget-workbench")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /combined/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("budget-scope-personal"));
    expect(screen.getByTestId("budget-loading")).not.toHaveAttribute(
      "aria-live",
    );
    await waitFor(() =>
      expect(screen.getByTestId("budget-scope-personal")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    fireEvent.click(screen.getByTestId("budget-scope-family"));
    await screen.findByText(/groceries/i);
    fireEvent.click(screen.getByTestId("budget-next-month"));
    await waitFor(() =>
      expect(screen.getByTestId("budget-month")).toHaveTextContent(
        /September 2026/i,
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/budgets\?.*month=2026-09-01/),
      expect.anything(),
    );

    fireEvent.click(screen.getByTestId("budget-create"));
    expect(screen.getByTestId("budget-form")).toBeVisible();
    chooseCategory("Dining");
    fireEvent.change(screen.getByTestId("budget-amount"), {
      target: { value: "250.00" },
    });
    fireEvent.change(screen.getByTestId("budget-effective-month"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.click(screen.getByTestId("budget-save"));

    await waitFor(() =>
      expect(screen.getByTestId("budget-target-list")).toHaveTextContent(
        /dining/i,
      ),
    );
    expect(screen.getByTestId("budget-target-list")).toHaveTextContent(
      /CAD|\$/,
    );
    expect(screen.getByTestId("budget-target-list")).toHaveTextContent(
      /250\.00/,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/budgets",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          scope: "family",
          categoryId: ids.dining,
          amountCents: 25000,
          effectiveMonth: "2026-09-01",
        }),
      }),
    );
  });

  it("FE-002 edits then archives by explicit effective month while historical month remains unchanged", async () => {
    const revised = {
      ...baseTarget,
      id: "b4000000-0000-4000-8000-000000000002",
      amountCents: 60000,
      effectiveMonth: "2026-09-01",
    };
    const september = {
      ...fullModelWith(revised, 10000),
      month: "2026-09-01",
      monthEnd: "2026-09-30",
    };
    const october = {
      ...september,
      month: "2026-10-01",
      monthEnd: "2026-10-31",
    };
    const archivedFuture = {
      ...october,
      budgets: [],
      summary: {
        targetCents: 0,
        spentCents: 0,
        remainingCents: 0,
        overBudgetCents: 0,
      },
    };
    let archived = false;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = String(input);
        if (init?.method === "PATCH") {
          const body = JSON.parse(String(init.body));
          if (body.archived) archived = true;
          return response({
            budget: body.archived
              ? { ...revised, endMonth: "2026-09-01", archived: true }
              : revised,
          });
        }
        if (url.includes("month=2026-09-01")) return response(september);
        if (url.includes("month=2026-10-01")) {
          return response(archived ? archivedFuture : october);
        }
        return response(initialModel);
      });
    render(<BudgetWorkbench initialModel={initialModel} />);

    fireEvent.click(screen.getByTestId("budget-edit-" + ids.budget));
    fireEvent.change(screen.getByTestId("budget-amount"), {
      target: { value: "600.00" },
    });
    fireEvent.change(screen.getByTestId("budget-effective-month"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.click(screen.getByTestId("budget-save"));

    await waitFor(() =>
      expect(screen.getByTestId("budget-target-list")).toHaveTextContent(
        /500\.00/,
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/budgets/" + ids.budget,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          amountCents: 60000,
          effectiveMonth: "2026-09-01",
        }),
      }),
    );

    fireEvent.click(screen.getByTestId("budget-next-month"));
    await waitFor(() =>
      expect(screen.getByTestId("budget-target-list")).toHaveTextContent(
        /600\.00/,
      ),
    );
    expect(screen.getByTestId("budget-month")).toHaveTextContent(
      /September 2026/i,
    );

    fireEvent.click(screen.getByTestId("budget-next-month"));
    await waitFor(() =>
      expect(screen.getByTestId("budget-month")).toHaveTextContent(
        /October 2026/i,
      ),
    );
    fireEvent.click(screen.getByTestId("budget-archive-" + revised.id));
    await waitFor(() =>
      expect(screen.getByTestId("budget-target-list")).not.toHaveTextContent(
        /groceries/i,
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/budgets/" + revised.id,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          archived: true,
          effectiveMonth: "2026-10-01",
        }),
      }),
    );

    fireEvent.click(screen.getByTestId("budget-previous-month"));
    await waitFor(() =>
      expect(screen.getByTestId("budget-target-list")).toHaveTextContent(
        /600\.00/,
      ),
    );
  });

  it("FE-003 renders 75, 90, 100 and over thresholds with text/icon semantics and complete amounts", () => {
    const thresholds = [
      {
        id: "watch",
        spentCents: 7500,
        percentageUsed: 75,
        status: "watch" as const,
      },
      {
        id: "close",
        spentCents: 9000,
        percentageUsed: 90,
        status: "close" as const,
      },
      {
        id: "limit",
        spentCents: 10000,
        percentageUsed: 100,
        status: "at-limit" as const,
      },
      {
        id: "over",
        spentCents: 12500,
        percentageUsed: 125,
        status: "over" as const,
      },
    ];
    const model = {
      ...initialModel,
      budgets: thresholds.map((entry) => ({
        ...baseTarget,
        id: entry.id,
        categoryId: entry.id,
        categoryName: entry.id,
        amountCents: 10000,
        spentCents: entry.spentCents,
        remainingCents: Math.max(10000 - entry.spentCents, 0),
        overBudgetCents: Math.max(entry.spentCents - 10000, 0),
        percentageUsed: entry.percentageUsed,
        status: entry.status,
      })),
      summary: {
        targetCents: 40000,
        spentCents: 41500,
        remainingCents: 3500,
        overBudgetCents: 2500,
      },
    };
    render(<BudgetWorkbench initialModel={model} />);

    for (const entry of thresholds) {
      const row = screen.getByTestId("budget-progress-" + entry.id);
      expect(screen.getByTestId("budget-status-" + entry.id)).toHaveTextContent(
        new RegExp(entry.status.replace("-", ".?"), "i"),
      );
      expect(row).toHaveTextContent(
        new RegExp(String(entry.percentageUsed) + "\\.0%"),
      );
      expect(row).toHaveAttribute(
        "aria-valuenow",
        String(Math.min(entry.percentageUsed, 100)),
      );
      expect(row).toHaveAttribute("aria-valuemax", "100");
      expect(row).toHaveTextContent(/spent/i);
      expect(row).toHaveTextContent(/remaining/i);
      expect(
        screen
          .getByTestId("budget-status-" + entry.id)
          .querySelector(
            "svg, [aria-hidden='true'], [data-icon], [data-shape]",
          ),
      ).not.toBeNull();
    }
    expect(screen.getByTestId("budget-progress-over")).toHaveTextContent(
      /over.*25\.00|25\.00.*over/i,
    );
  });

  it("FE-004 announces save failure while retaining the last model and entered values", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      response({ error: "Budget save failed. Try again." }, 503),
    );
    render(<BudgetWorkbench initialModel={initialModel} />);
    fireEvent.click(screen.getByTestId("budget-create"));
    chooseCategory("Dining");
    fireEvent.change(screen.getByTestId("budget-amount"), {
      target: { value: "321.45" },
    });
    fireEvent.change(screen.getByTestId("budget-effective-month"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.click(screen.getByTestId("budget-save"));

    const error = await screen.findByTestId("budget-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent(/try again|retry/i);
    expect(screen.getByTestId("budget-target-list")).toHaveTextContent(
      /groceries/i,
    );
    expect(screen.getByTestId("budget-amount")).toHaveValue("321.45");
    expect(screen.getByTestId("budget-category")).toHaveAttribute(
      "data-value",
      ids.dining,
    );
    expect(screen.getByTestId("budget-effective-month")).toHaveValue(
      "2026-09-01",
    );
  });

  it("FE-004 closes a committed form and preserves the last model when only refresh fails", async () => {
    const created = {
      ...baseTarget,
      id: "b4000000-0000-4000-8000-000000000099",
      categoryId: ids.dining,
      categoryName: "Dining",
      amountCents: 43210,
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => response({ budget: created }, 201))
      .mockImplementationOnce(() =>
        response({ error: "Ledger refresh unavailable." }, 503),
      );

    render(<BudgetWorkbench initialModel={initialModel} />);
    fireEvent.click(screen.getByTestId("budget-create"));
    chooseCategory("Dining");
    fireEvent.change(screen.getByTestId("budget-amount"), {
      target: { value: "432.10" },
    });
    fireEvent.change(screen.getByTestId("budget-effective-month"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.click(screen.getByTestId("budget-save"));

    const error = await screen.findByTestId("budget-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent(
      /saved.*refreshed ledger.*could not be loaded|showing the previous monthly view/i,
    );
    expect(screen.queryByTestId("budget-form")).not.toBeInTheDocument();
    expect(screen.getByTestId("budget-target-list")).toHaveTextContent(
      /groceries/i,
    );
    expect(screen.getByTestId("budget-target-list")).not.toHaveTextContent(
      /dining/i,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("budget-create")).toBeEnabled();
  });
  it("FE-005 exposes named keyboard controls, visible focus, reduced-motion and overflow-safe layout", () => {
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
    render(<BudgetWorkbench initialModel={initialModel} />);
    for (const id of [
      "budget-scope-family",
      "budget-scope-personal",
      "budget-previous-month",
      "budget-next-month",
      "budget-create",
    ]) {
      expect(screen.getByTestId(id)).toHaveAccessibleName();
    }
    expect(screen.getByTestId("budget-month")).toHaveTextContent(
      /August 2026/i,
    );
    const create = screen.getByTestId("budget-create");
    create.focus();
    expect(create).toHaveFocus();
    expect(screen.getByTestId("budget-workbench").className).toMatch(
      /overflow(?:-x)?-hidden|max-w-full|w-full/,
    );
  });
});

describe("GH-33 budget workbench pending controls", () => {
  it("FE-005 labels refresh, save, and archive; disables the whole workbench; ignores repeats; and recovers from failure", async () => {
    const refreshRequest = deferredResponse();
    const saveRequest = deferredResponse();
    const archiveRequest = deferredResponse();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => refreshRequest.promise)
      .mockImplementationOnce(() => saveRequest.promise)
      .mockImplementationOnce(() => archiveRequest.promise);
    render(<BudgetWorkbench initialModel={initialModel} />);

    const nextMonth = screen.getByTestId("budget-next-month");
    act(() => {
      nextMonth.click();
      nextMonth.click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(nextMonth).toHaveTextContent("Updating…");
    expect(nextMonth).toHaveAttribute("data-pending", "true");
    for (const id of [
      "budget-scope-family",
      "budget-scope-personal",
      "budget-previous-month",
      "budget-next-month",
      "budget-create",
      `budget-edit-${ids.budget}`,
      `budget-archive-${ids.budget}`,
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }

    await act(async () => {
      refreshRequest.resolve(
        new Response(
          JSON.stringify({ error: "Budget ledger could not be refreshed." }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      );
      await refreshRequest.promise;
    });
    await waitFor(() =>
      expect(screen.getByTestId("budget-error")).toHaveTextContent(
        "Budget ledger could not be refreshed.",
      ),
    );
    expect(nextMonth).toBeEnabled();
    expect(nextMonth).toHaveAttribute("data-pending", "false");

    fireEvent.click(screen.getByTestId("budget-create"));
    chooseCategory("Dining");
    fireEvent.change(screen.getByTestId("budget-amount"), {
      target: { value: "321.45" },
    });
    const save = screen.getByTestId("budget-save");
    act(() => {
      save.click();
      save.click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(save).toHaveTextContent("Saving…");
    expect(save).toHaveAttribute("data-pending", "true");
    expect(save).toBeDisabled();
    for (const id of [
      "budget-scope-family",
      "budget-scope-personal",
      "budget-previous-month",
      "budget-next-month",
      "budget-create",
      `budget-edit-${ids.budget}`,
      `budget-archive-${ids.budget}`,
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }

    await act(async () => {
      saveRequest.resolve(
        new Response(
          JSON.stringify({ error: "Budget save failed. Try again." }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      );
      await saveRequest.promise;
    });
    await waitFor(() =>
      expect(screen.getByTestId("budget-error")).toHaveTextContent(
        "Budget save failed. Try again.",
      ),
    );
    expect(save).toHaveTextContent("Save");
    expect(save).toHaveAttribute("data-pending", "false");
    expect(save).toBeEnabled();

    fireEvent.click(screen.getByTestId("budget-cancel"));
    const archive = screen.getByTestId(`budget-archive-${ids.budget}`);
    act(() => {
      archive.click();
      archive.click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(archive).toHaveTextContent("Archiving…");
    expect(archive).toHaveAttribute("data-pending", "true");
    expect(archive).toBeDisabled();
    expect(screen.getByTestId(`budget-edit-${ids.budget}`)).toBeDisabled();
    expect(screen.getByTestId("budget-create")).toBeDisabled();

    await act(async () => {
      archiveRequest.resolve(
        new Response(JSON.stringify({ error: "Archive failed. Try again." }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      );
      await archiveRequest.promise;
    });
    await waitFor(() =>
      expect(screen.getByTestId("budget-error")).toHaveTextContent(
        "Archive failed. Try again.",
      ),
    );
    expect(archive).toHaveTextContent("Archive");
    expect(archive).toHaveAttribute("data-pending", "false");
    expect(archive).toBeEnabled();
    expect(screen.getByTestId(`budget-edit-${ids.budget}`)).toBeEnabled();
  });
});

describe("GH-51 compact Budgets route surface", () => {
  it("FE-002 removes the editorial masthead so month controls and budget work begin immediately", () => {
    render(<BudgetWorkbench initialModel={initialModel} />);

    const workbench = screen.getByTestId("budget-workbench");
    expect(within(workbench).queryByRole("heading", { level: 1 })).toBeNull();
    expect(workbench).not.toHaveTextContent(
      /Monthly allocation ledger|Set the line\. Watch the month answer\.|Targets recur without rewriting history/i,
    );

    const month = screen.getByTestId("budget-month");
    const summary = screen.getByRole("region", { name: /budget summary/i });
    expect(month).toBeVisible();
    expect(
      month.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId("budget-target-list")).toBeInTheDocument();
  });
});
