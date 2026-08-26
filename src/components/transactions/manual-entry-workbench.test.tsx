import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";

import { ManualEntryWorkbench } from "./manual-entry-workbench";

const actorId = "10000000-0000-4000-8000-000000000001";
const categoryId = "30000000-0000-4000-8000-000000000001";
const categories = [
  {
    id: categoryId,
    name: "Groceries",
    color: "#18745B",
    scope: "family" as const,
    ownerProfileId: null,
    systemKey: null,
    archivedAt: null,
    inUse: true,
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    name: "Cash income",
    color: "#477B74",
    scope: "personal" as const,
    ownerProfileId: actorId,
    systemKey: null,
    archivedAt: null,
    inUse: true,
  },
];
const personalEntry = {
  id: "40000000-0000-4000-8000-000000000001",
  source: "manual" as const,
  scope: "personal" as const,
  ownerProfileId: actorId,
  kind: "income" as const,
  amount: "1250.00",
  currencyCode: "CAD" as const,
  entryDate: "2026-08-12",
  description: "Cash tutoring",
  categoryId: categories[1]!.id,
  notes: "August sessions",
  createdBy: actorId,
  lastEditedBy: actorId,
  createdAt: "2026-08-12T16:00:00.000Z",
  updatedAt: "2026-08-12T16:00:00.000Z",
  deletedAt: null,
  deletedBy: null,
};
const familyEntry = {
  ...personalEntry,
  id: "40000000-0000-4000-8000-000000000002",
  scope: "family" as const,
  ownerProfileId: null,
  kind: "spending" as const,
  amount: "-42.75",
  description: "Neighbourhood market",
  categoryId,
  notes: "Bread and fruit",
};
const refundEntry = {
  ...familyEntry,
  id: "40000000-0000-4000-8000-000000000003",
  kind: "refund" as const,
  amount: "12.50",
  description: "Market refund",
};

function jsonResponse(body: unknown, status = 200) {
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

function form() {
  return {
    scope: screen.getByTestId("manual-entry-scope"),
    kind: screen.getByTestId("manual-entry-kind"),
    amount: screen.getByTestId("manual-entry-amount"),
    date: screen.getByTestId("manual-entry-date"),
    description: screen.getByTestId("manual-entry-description"),
    category: screen.getByTestId("manual-entry-category"),
    notes: screen.getByTestId("manual-entry-notes"),
    submit: screen.getByTestId("manual-entry-submit"),
  };
}

function choose(testId: string, label: string) {
  fireEvent.click(screen.getByTestId(testId));
  fireEvent.click(screen.getByRole("option", { name: new RegExp(label, "i") }));
}
function fillEntry(input: {
  scope: "family" | "personal";
  kind: "income" | "spending" | "refund";
  amount: string;
  description: string;
  categoryId: string;
  notes?: string;
}) {
  const controls = form();
  choose("manual-entry-scope", input.scope);
  choose("manual-entry-kind", input.kind);
  fireEvent.change(controls.amount, { target: { value: input.amount } });
  fireEvent.change(controls.date, { target: { value: "2026-08-12" } });
  fireEvent.change(controls.description, {
    target: { value: input.description },
  });
  choose(
    "manual-entry-category",
    categories.find((category) => category.id === input.categoryId)!.name,
  );
  fireEvent.change(controls.notes, {
    target: { value: input.notes ?? "" },
  });
  fireEvent.click(controls.submit);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("GH-8 manual/cash ledger acceptance", () => {
  it("FE-001 creates Personal income plus Family spending/refund with explicit scope, kind, category, notes, signed validation, and Manual source labels", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => jsonResponse({ entry: personalEntry }, 201))
      .mockImplementationOnce(() => jsonResponse({ entry: familyEntry }, 201))
      .mockImplementationOnce(() => jsonResponse({ entry: refundEntry }, 201));

    render(
      <ManualEntryWorkbench initialEntries={[]} categories={categories} />,
    );

    expect(screen.getByTestId("manual-entry-workbench")).toBeVisible();
    expect(screen.getByTestId("manual-entry-form")).toBeVisible();
    expect(form().scope).toHaveAccessibleName(/scope|privacy/i);
    expect(form().kind).toHaveAccessibleName(/kind|type/i);
    expect(form().amount).toHaveAccessibleName(/amount/i);
    expect(form().date).toHaveAccessibleName(/date/i);
    expect(form().description).toHaveAccessibleName(/description/i);
    expect(form().category).toHaveAccessibleName(/category/i);
    expect(form().notes).toHaveAccessibleName(/notes/i);

    fillEntry({
      scope: "personal",
      kind: "income",
      amount: "1250.00",
      description: "Cash tutoring",
      categoryId: categories[1]!.id,
      notes: "August sessions",
    });
    await waitFor(() =>
      expect(
        screen.getByTestId(`manual-entry-row-${personalEntry.id}`),
      ).toBeVisible(),
    );

    fillEntry({
      scope: "family",
      kind: "spending",
      amount: "-42.75",
      description: "Neighbourhood market",
      categoryId,
      notes: "Bread and fruit",
    });
    await waitFor(() =>
      expect(
        screen.getByTestId(`manual-entry-row-${familyEntry.id}`),
      ).toBeVisible(),
    );

    fillEntry({
      scope: "family",
      kind: "refund",
      amount: "12.50",
      description: "Market refund",
      categoryId,
    });
    await waitFor(() =>
      expect(
        screen.getByTestId(`manual-entry-row-${refundEntry.id}`),
      ).toBeVisible(),
    );

    for (const entry of [personalEntry, familyEntry, refundEntry]) {
      expect(
        screen.getByTestId(`manual-entry-row-${entry.id}`),
      ).toHaveTextContent(/manual|cash/i);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/manual-entries",
      expect.objectContaining({ method: "POST" }),
    );
    expect(
      JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)),
    ).toMatchObject({
      scope: "family",
      kind: "spending",
      amount: "-42.75",
      categoryId,
      notes: "Bread and fruit",
    });
  });

  it("FE-002 pre-fills edits, saves them with history, and exposes server field errors without losing input", async () => {
    const edited = {
      ...familyEntry,
      description: "Neighbourhood market — corrected",
      notes: "Shared groceries",
      lastEditedBy: "10000000-0000-4000-8000-000000000002",
      updatedAt: "2026-08-12T18:00:00.000Z",
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => jsonResponse({ entry: edited }))
      .mockImplementationOnce(() =>
        jsonResponse(
          {
            error: {
              code: "validation_failed",
              message: "Check the highlighted fields.",
              fields: { amount: "Spending must be less than zero." },
            },
          },
          400,
        ),
      );

    render(
      <ManualEntryWorkbench
        initialEntries={[familyEntry]}
        categories={categories}
      />,
    );

    fireEvent.click(screen.getByTestId(`manual-entry-edit-${familyEntry.id}`));
    expect(form().scope).toHaveAttribute("data-value", "family");
    expect(form().kind).toHaveAttribute("data-value", "spending");
    expect(form().amount).toHaveValue(-42.75);
    expect(form().description).toHaveValue("Neighbourhood market");
    expect(form().notes).toHaveValue("Bread and fruit");

    fireEvent.change(form().description, {
      target: { value: edited.description },
    });
    fireEvent.change(form().notes, { target: { value: edited.notes } });
    fireEvent.click(form().submit);

    await waitFor(() =>
      expect(
        screen.getByTestId(`manual-entry-row-${familyEntry.id}`),
      ).toHaveTextContent(edited.description),
    );
    expect(
      screen.getByTestId(`manual-entry-row-${familyEntry.id}`),
    ).toHaveTextContent(/created|edited|author/i);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/manual-entries/${familyEntry.id}`,
      expect.objectContaining({ method: "PATCH" }),
    );

    fireEvent.click(screen.getByTestId(`manual-entry-edit-${familyEntry.id}`));
    fireEvent.change(form().amount, { target: { value: "42.75" } });
    fireEvent.change(form().description, {
      target: { value: "Preserve this correction" },
    });
    fireEvent.click(form().submit);

    await waitFor(() =>
      expect(screen.getByTestId("manual-entry-error")).toHaveTextContent(
        /spending must be less than zero|check the highlighted fields/i,
      ),
    );
    expect(screen.getByTestId("manual-entry-error")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(form().amount).toHaveValue(42.75);
    expect(form().description).toHaveValue("Preserve this correction");
  });

  it("FE-003 deletes Personal directly while Family deletion requires cancellable confirmation", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        jsonResponse({
          entry: {
            ...personalEntry,
            deletedAt: "2026-08-12T19:00:00.000Z",
            deletedBy: actorId,
          },
        }),
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          entry: {
            ...familyEntry,
            deletedAt: "2026-08-12T19:01:00.000Z",
            deletedBy: actorId,
          },
        }),
      );

    render(
      <ManualEntryWorkbench
        initialEntries={[personalEntry, familyEntry]}
        categories={categories}
      />,
    );

    fireEvent.click(
      screen.getByTestId(`manual-entry-delete-${personalEntry.id}`),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId(`manual-entry-row-${personalEntry.id}`),
      ).not.toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/manual-entries/${personalEntry.id}`,
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ confirmed: false }),
      }),
    );

    fireEvent.click(
      screen.getByTestId(`manual-entry-delete-${familyEntry.id}`),
    );
    expect(
      screen.getByTestId(`manual-entry-delete-confirm-${familyEntry.id}`),
    ).toBeVisible();
    expect(
      screen.getByTestId(`manual-entry-delete-cancel-${familyEntry.id}`),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByTestId(`manual-entry-delete-cancel-${familyEntry.id}`),
    );
    expect(
      screen.getByTestId(`manual-entry-row-${familyEntry.id}`),
    ).toBeVisible();
    expect(
      screen.queryByTestId(`manual-entry-delete-confirm-${familyEntry.id}`),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId(`manual-entry-delete-${familyEntry.id}`),
    );
    fireEvent.click(
      screen.getByTestId(`manual-entry-delete-confirm-${familyEntry.id}`),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId(`manual-entry-row-${familyEntry.id}`),
      ).not.toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/manual-entries/${familyEntry.id}`,
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ confirmed: true }),
      }),
    );
  });

  it("FE-004 keeps every control keyboard accessible and exposes a filtered CSV download", () => {
    render(
      <ManualEntryWorkbench
        initialEntries={[familyEntry]}
        categories={categories}
      />,
    );

    const controls = form();
    for (const control of [
      controls.scope,
      controls.kind,
      controls.amount,
      controls.date,
      controls.description,
      controls.category,
      controls.notes,
      controls.submit,
      screen.getByTestId("manual-entry-export"),
    ]) {
      control.focus();
      expect(control).toHaveFocus();
    }

    const exportControl = screen.getByTestId("manual-entry-export");
    expect(exportControl).toHaveAccessibleName(/export|csv/i);
    if (exportControl instanceof HTMLAnchorElement) {
      expect(exportControl.href).toMatch(
        /\/api\/manual-entries\?.*format=csv|\/api\/manual-entries\?format=csv/,
      );
      expect(exportControl).toHaveAttribute("download");
    }
  });
});

describe("GH-33 manual/cash pending controls", () => {
  it("FE-006 labels create, edit, and removal; disables all row mutations; ignores repeats; and retains form/error behavior", async () => {
    const createRequest = deferredResponse();
    const editRequest = deferredResponse();
    const removeRequest = deferredResponse();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => createRequest.promise)
      .mockImplementationOnce(() => editRequest.promise)
      .mockImplementationOnce(() => removeRequest.promise);
    render(
      <ManualEntryWorkbench
        initialEntries={[familyEntry, personalEntry]}
        categories={categories}
      />,
    );

    choose("manual-entry-kind", "income");
    fireEvent.change(form().amount, { target: { value: "1250.00" } });
    fireEvent.change(form().date, { target: { value: "2026-08-12" } });
    fireEvent.change(form().description, {
      target: { value: "Cash tutoring retry" },
    });
    choose("manual-entry-category", "Cash income");
    const submit = form().submit;
    act(() => {
      submit.click();
      submit.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(submit).toHaveTextContent("Recording…");
    expect(submit).toHaveAttribute("data-pending", "true");
    expect(submit).toBeDisabled();
    for (const control of screen.getAllByTestId(
      /^manual-entry-(edit|delete)-/,
    )) {
      expect(control).toBeDisabled();
    }

    await act(async () => {
      createRequest.resolve(
        new Response(
          JSON.stringify({
            error: { message: "The entry could not be saved. Try again." },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      );
      await createRequest.promise;
    });
    await waitFor(() =>
      expect(screen.getByTestId("manual-entry-error")).toHaveTextContent(
        "The entry could not be saved. Try again.",
      ),
    );
    expect(submit).toHaveTextContent("Record entry");
    expect(submit).toHaveAttribute("data-pending", "false");
    expect(submit).toBeEnabled();
    expect(form().description).toHaveValue("Cash tutoring retry");

    fireEvent.click(screen.getByTestId(`manual-entry-edit-${familyEntry.id}`));
    fireEvent.change(form().description, {
      target: { value: "Preserve failed revision" },
    });
    act(() => {
      form().submit.click();
      form().submit.click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(form().submit).toHaveTextContent("Recording…");
    expect(form().submit).toHaveAttribute("data-pending", "true");
    for (const control of screen.getAllByTestId(
      /^manual-entry-(edit|delete)-/,
    )) {
      expect(control).toBeDisabled();
    }

    await act(async () => {
      editRequest.resolve(
        new Response(
          JSON.stringify({
            error: { message: "The entry could not be saved. Try again." },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      );
      await editRequest.promise;
    });
    await waitFor(() =>
      expect(screen.getByTestId("manual-entry-error")).toHaveTextContent(
        "The entry could not be saved. Try again.",
      ),
    );
    expect(form().description).toHaveValue("Preserve failed revision");
    expect(form().submit).toHaveTextContent("Save revision");
    expect(form().submit).toHaveAttribute("data-pending", "false");
    expect(form().submit).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(
      screen.getByTestId(`manual-entry-delete-${familyEntry.id}`),
    );
    const confirm = screen.getByTestId(
      `manual-entry-delete-confirm-${familyEntry.id}`,
    );
    act(() => {
      confirm.click();
      confirm.click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(confirm).toHaveTextContent("Removing…");
    expect(confirm).toHaveAttribute("data-pending", "true");
    expect(confirm).toBeDisabled();
    expect(form().submit).toBeDisabled();
    expect(
      screen.getByTestId(`manual-entry-edit-${personalEntry.id}`),
    ).toBeDisabled();
    expect(
      screen.getByTestId(`manual-entry-delete-${personalEntry.id}`),
    ).toBeDisabled();

    await act(async () => {
      removeRequest.resolve(
        new Response(
          JSON.stringify({
            error: { message: "The entry could not be deleted. Try again." },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      );
      await removeRequest.promise;
    });
    await waitFor(() =>
      expect(screen.getByTestId("manual-entry-error")).toHaveTextContent(
        "The entry could not be deleted. Try again.",
      ),
    );
    expect(confirm).toHaveTextContent("Confirm removal");
    expect(confirm).toHaveAttribute("data-pending", "false");
    expect(confirm).toBeEnabled();
    expect(form().submit).toBeEnabled();
    expect(
      screen.getByTestId(`manual-entry-edit-${personalEntry.id}`),
    ).toBeEnabled();
    expect(
      screen.getByTestId(`manual-entry-delete-${personalEntry.id}`),
    ).toBeEnabled();
  });
});

describe("GH-64 Manual route export visibility", () => {
  it("FE-006 keeps Manual CSV out of mobile layout and accessibility while retaining the desktop toolbar control", () => {
    render(
      <ManualEntryWorkbench
        initialEntries={[familyEntry]}
        categories={categories}
        viewScope="family"
      />,
    );

    const exportControl = screen.getByTestId("manual-entry-export");
    expect(exportControl).toHaveClass("hidden");
    expect(
      exportControl.className
        .split(/\s+/)
        .some((token) => token.startsWith("md:")),
    ).toBe(true);
    expect(exportControl).toHaveAttribute(
      "href",
      "/api/manual-entries?scope=family&format=csv",
    );
  });
});
