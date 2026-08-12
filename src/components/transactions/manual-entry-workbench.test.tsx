import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

function fillEntry(input: {
  scope: "family" | "personal";
  kind: "income" | "spending" | "refund";
  amount: string;
  description: string;
  categoryId: string;
  notes?: string;
}) {
  const controls = form();
  fireEvent.change(controls.scope, { target: { value: input.scope } });
  fireEvent.change(controls.kind, { target: { value: input.kind } });
  fireEvent.change(controls.amount, { target: { value: input.amount } });
  fireEvent.change(controls.date, { target: { value: "2026-08-12" } });
  fireEvent.change(controls.description, {
    target: { value: input.description },
  });
  fireEvent.change(controls.category, {
    target: { value: input.categoryId },
  });
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
    expect(form().scope).toHaveValue("family");
    expect(form().kind).toHaveValue("spending");
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
