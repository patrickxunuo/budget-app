import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/manual-entries/service", () => {
  class ManualEntryServiceError extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string,
      message: string,
      public readonly fields?: Record<string, string>,
    ) {
      super(message);
    }
  }

  return {
    ManualEntryServiceError,
    getManualEntryContext: vi.fn(),
    listManualEntries: vi.fn(),
    createManualEntry: vi.fn(),
    updateManualEntry: vi.fn(),
    deleteManualEntry: vi.fn(),
    manualEntriesToCsv: vi.fn(),
    toManualEntryApiErrorResponse: vi.fn((error: unknown) => {
      if (error instanceof SyntaxError)
        return Response.json(
          {
            error: {
              code: "validation_error",
              message: "Request body must be valid JSON.",
              fields: { request: "Request body must be valid JSON." },
            },
          },
          { status: 400 },
        );
      const entryError = error as InstanceType<
        typeof ManualEntryServiceError
      > & {
        issues?: Array<{ path: PropertyKey[]; message: string }>;
      };
      const issueFields = Object.fromEntries(
        (entryError.issues ?? []).map((issue) => [
          String(issue.path[0] ?? "request"),
          issue.message,
        ]),
      );
      const fields =
        entryError.fields ??
        (Object.keys(issueFields).length > 0 ? issueFields : undefined);
      return Response.json(
        {
          error: {
            code: entryError.code ?? "invalid_request",
            message:
              entryError.message ?? "The request could not be completed.",
            ...(fields ? { fields } : {}),
          },
        },
        { status: entryError.status ?? 400 },
      );
    }),
  };
});

import {
  ManualEntryServiceError,
  createManualEntry,
  deleteManualEntry,
  getManualEntryContext,
  listManualEntries,
  manualEntriesToCsv,
  updateManualEntry,
} from "@/lib/manual-entries/service";
import { DELETE, PATCH } from "./[id]/route";
import { GET, POST } from "./route";

const actor = {
  supabase: {},
  userId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000001",
};
const categoryId = "30000000-0000-4000-8000-000000000001";
const entryId = "40000000-0000-4000-8000-000000000001";
const personalIncome = {
  id: entryId,
  source: "manual" as const,
  scope: "personal" as const,
  ownerProfileId: actor.userId,
  kind: "income" as const,
  amount: "1250.00",
  currencyCode: "CAD" as const,
  entryDate: "2026-08-12",
  description: "Cash tutoring",
  categoryId,
  notes: "August sessions",
  createdBy: actor.userId,
  lastEditedBy: actor.userId,
  createdAt: "2026-08-12T16:00:00.000Z",
  updatedAt: "2026-08-12T16:00:00.000Z",
  deletedAt: null,
  deletedBy: null,
};
const familySpending = {
  ...personalIncome,
  id: "40000000-0000-4000-8000-000000000002",
  scope: "family" as const,
  ownerProfileId: null,
  kind: "spending" as const,
  amount: "-42.75",
  description: "Neighbourhood market",
  notes: 'Bread, fruit, and "treats"',
};
const familyRefund = {
  ...familySpending,
  id: "40000000-0000-4000-8000-000000000003",
  kind: "refund" as const,
  amount: "12.50",
  description: "Market refund",
};

function jsonRequest(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body: unknown,
) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getManualEntryContext).mockResolvedValue(actor as never);
});

describe("GH-8 manual-entry route acceptance", () => {
  it("API-001 lists only visible, non-deleted entries using scope/date/category filters", async () => {
    vi.mocked(listManualEntries).mockResolvedValue([personalIncome]);

    const response = await GET(
      new Request(
        `http://localhost/api/manual-entries?scope=personal&from=2026-08-01&to=2026-08-31&categoryId=${categoryId}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ entries: [personalIncome] });
    expect(listManualEntries).toHaveBeenCalledExactlyOnceWith(actor, {
      scope: "personal",
      from: "2026-08-01",
      to: "2026-08-31",
      categoryId,
    });
  });

  it("API-002 creates valid Personal income with canonical ownership and positive CAD amount", async () => {
    vi.mocked(createManualEntry).mockResolvedValue(personalIncome);

    const response = await POST(
      jsonRequest("/api/manual-entries", "POST", {
        scope: "personal",
        kind: "income",
        amount: "1250.00",
        entryDate: "2026-08-12",
        description: "  Cash tutoring  ",
        categoryId,
        notes: "  August sessions  ",
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ entry: personalIncome });
    expect(createManualEntry).toHaveBeenCalledExactlyOnceWith(actor, {
      scope: "personal",
      kind: "income",
      amount: "1250.00",
      entryDate: "2026-08-12",
      description: "Cash tutoring",
      categoryId,
      notes: "August sessions",
    });
  });

  it("API-003 creates Family spending and refund with explicit kinds and signed values", async () => {
    vi.mocked(createManualEntry)
      .mockResolvedValueOnce(familySpending)
      .mockResolvedValueOnce(familyRefund);

    const spending = await POST(
      jsonRequest("/api/manual-entries", "POST", {
        scope: "family",
        kind: "spending",
        amount: "-42.75",
        entryDate: "2026-08-12",
        description: "Neighbourhood market",
        categoryId,
        notes: null,
      }),
    );
    const refund = await POST(
      jsonRequest("/api/manual-entries", "POST", {
        scope: "family",
        kind: "refund",
        amount: "12.50",
        entryDate: "2026-08-12",
        description: "Market refund",
        categoryId,
      }),
    );

    expect([spending.status, refund.status]).toEqual([201, 201]);
    expect(await spending.json()).toEqual({ entry: familySpending });
    expect(await refund.json()).toEqual({ entry: familyRefund });
    expect(createManualEntry).toHaveBeenNthCalledWith(
      1,
      actor,
      expect.objectContaining({
        scope: "family",
        kind: "spending",
        amount: "-42.75",
      }),
    );
    expect(createManualEntry).toHaveBeenNthCalledWith(
      2,
      actor,
      expect.objectContaining({
        scope: "family",
        kind: "refund",
        amount: "12.50",
      }),
    );
  });

  it.each([
    ["zero amount", { amount: "0.00" }, "amount"],
    ["wrong spending sign", { kind: "spending", amount: "4.00" }, "amount"],
    ["impossible date", { entryDate: "2026-02-30" }, "entryDate"],
    ["blank description", { description: "   " }, "description"],
    ["missing category", { categoryId: "" }, "categoryId"],
  ])(
    "API-004 rejects %s with structured field errors and no write",
    async (_case, override, field) => {
      const response = await POST(
        jsonRequest("/api/manual-entries", "POST", {
          scope: "personal",
          kind: "income",
          amount: "10.00",
          entryDate: "2026-08-12",
          description: "Cash income",
          categoryId,
          ...override,
        }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: expect.objectContaining({
          code: expect.any(String),
          message: expect.any(String),
          fields: expect.objectContaining({ [field]: expect.any(String) }),
        }),
      });
      expect(createManualEntry).not.toHaveBeenCalled();
    },
  );

  it("API-005 edits an owned Personal entry while scope and original author stay immutable", async () => {
    const edited = {
      ...personalIncome,
      amount: "1300.00",
      description: "Cash tutoring — revised",
      updatedAt: "2026-08-12T17:00:00.000Z",
    };
    vi.mocked(updateManualEntry).mockResolvedValue(edited);

    const response = await PATCH(
      jsonRequest(`/api/manual-entries/${entryId}`, "PATCH", {
        amount: "1300.00",
        description: " Cash tutoring — revised ",
      }),
      routeContext(entryId),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ entry: edited });
    expect(updateManualEntry).toHaveBeenCalledExactlyOnceWith(actor, entryId, {
      amount: "1300.00",
      description: "Cash tutoring — revised",
    });
    expect(edited).toMatchObject({
      scope: "personal",
      ownerProfileId: actor.userId,
      createdBy: actor.userId,
      lastEditedBy: actor.userId,
    });
  });

  it("API-006 returns indistinguishable 404 when another member targets a Personal entry", async () => {
    vi.mocked(updateManualEntry).mockRejectedValue(
      new ManualEntryServiceError(
        404,
        "manual_entry_not_found",
        "Manual entry not found.",
      ),
    );

    const response = await PATCH(
      jsonRequest(`/api/manual-entries/${entryId}`, "PATCH", {
        notes: "snoop",
      }),
      routeContext(entryId),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "manual_entry_not_found",
        message: "Manual entry not found.",
      },
    });
  });

  it("API-007 lets an active member edit Family data while preserving its author", async () => {
    const editedBy = "10000000-0000-4000-8000-000000000002";
    const edited = {
      ...familySpending,
      notes: "Household groceries",
      lastEditedBy: editedBy,
      updatedAt: "2026-08-12T18:00:00.000Z",
    };
    vi.mocked(updateManualEntry).mockResolvedValue(edited);

    const response = await PATCH(
      jsonRequest(`/api/manual-entries/${familySpending.id}`, "PATCH", {
        notes: "Household groceries",
      }),
      routeContext(familySpending.id),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ entry: edited });
    expect(edited.createdBy).toBe(actor.userId);
    expect(edited.lastEditedBy).toBe(editedBy);
  });

  it("API-008 rejects unconfirmed Family deletion without mutating the row", async () => {
    vi.mocked(deleteManualEntry).mockRejectedValue(
      new ManualEntryServiceError(
        400,
        "family_confirmation_required",
        "Confirm deletion of this Family entry.",
        { confirmed: "Confirmation is required." },
      ),
    );

    const response = await DELETE(
      jsonRequest(`/api/manual-entries/${familySpending.id}`, "DELETE", {
        confirmed: false,
      }),
      routeContext(familySpending.id),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "family_confirmation_required",
        message: "Confirm deletion of this Family entry.",
        fields: { confirmed: "Confirmation is required." },
      },
    });
    expect(deleteManualEntry).toHaveBeenCalledExactlyOnceWith(
      actor,
      familySpending.id,
      false,
    );
  });

  it("API-009 soft-deletes confirmed Family and owned Personal entries with actor/time audit", async () => {
    const deletedAt = "2026-08-12T19:00:00.000Z";
    const deletedFamily = {
      ...familySpending,
      deletedAt,
      deletedBy: actor.userId,
    };
    const deletedPersonal = {
      ...personalIncome,
      deletedAt,
      deletedBy: actor.userId,
    };
    vi.mocked(deleteManualEntry)
      .mockResolvedValueOnce(deletedFamily)
      .mockResolvedValueOnce(deletedPersonal);

    const familyResponse = await DELETE(
      jsonRequest(`/api/manual-entries/${familySpending.id}`, "DELETE", {
        confirmed: true,
      }),
      routeContext(familySpending.id),
    );
    const personalResponse = await DELETE(
      jsonRequest(`/api/manual-entries/${personalIncome.id}`, "DELETE", {
        confirmed: false,
      }),
      routeContext(personalIncome.id),
    );

    expect([familyResponse.status, personalResponse.status]).toEqual([
      200, 200,
    ]);
    expect(await familyResponse.json()).toEqual({ entry: deletedFamily });
    expect(await personalResponse.json()).toEqual({ entry: deletedPersonal });
    expect(deleteManualEntry).toHaveBeenNthCalledWith(
      1,
      actor,
      familySpending.id,
      true,
    );
    expect(deleteManualEntry).toHaveBeenNthCalledWith(
      2,
      actor,
      personalIncome.id,
      false,
    );
  });

  it("API-010 exports stable RFC 4180 CSV columns for current filtered visible rows", async () => {
    const csv =
      "date,description,source,scope,kind,amount,currency,category,notes,created_by,last_edited_by\r\n" +
      '2026-08-12,Neighbourhood market,manual,family,spending,-42.75,CAD,Groceries,"Bread, fruit, and ""treats""",GH8 Owner,GH8 Owner\r\n';
    vi.mocked(listManualEntries).mockResolvedValue([familySpending]);
    vi.mocked(manualEntriesToCsv).mockReturnValue(csv);

    const response = await GET(
      new Request(
        `http://localhost/api/manual-entries?scope=family&categoryId=${categoryId}&format=csv`,
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/csv/i);
    expect(response.headers.get("content-disposition")).toMatch(/attachment/i);
    expect(await response.text()).toBe(csv);
    expect(listManualEntries).toHaveBeenCalledWith(actor, {
      scope: "family",
      categoryId,
    });
    expect(manualEntriesToCsv).toHaveBeenCalledExactlyOnceWith([
      familySpending,
    ]);
  });

  it("API-011 rejects unauthenticated or inactive callers across collection and item routes with no write", async () => {
    vi.mocked(getManualEntryContext)
      .mockRejectedValueOnce(
        new ManualEntryServiceError(
          401,
          "authentication_required",
          "Sign in to continue.",
        ),
      )
      .mockRejectedValueOnce(
        new ManualEntryServiceError(
          403,
          "active_membership_required",
          "An active membership is required.",
        ),
      )
      .mockRejectedValueOnce(
        new ManualEntryServiceError(
          403,
          "active_membership_required",
          "An active membership is required.",
        ),
      );

    const listResponse = await GET(
      new Request("http://localhost/api/manual-entries"),
    );
    const createResponse = await POST(
      jsonRequest("/api/manual-entries", "POST", {
        scope: "family",
        kind: "income",
        amount: "1.00",
        entryDate: "2026-08-12",
        description: "Blocked",
        categoryId,
      }),
    );
    const deleteResponse = await DELETE(
      jsonRequest(`/api/manual-entries/${entryId}`, "DELETE", {
        confirmed: true,
      }),
      routeContext(entryId),
    );

    expect([
      listResponse.status,
      createResponse.status,
      deleteResponse.status,
    ]).toEqual([401, 403, 403]);
    expect(createManualEntry).not.toHaveBeenCalled();
    expect(updateManualEntry).not.toHaveBeenCalled();
    expect(deleteManualEntry).not.toHaveBeenCalled();
  });

  it("returns structured 400 responses for malformed JSON and invalid item IDs", async () => {
    const malformed = await POST(
      new Request("http://localhost/api/manual-entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({
      error: {
        code: "validation_error",
        fields: { request: expect.any(String) },
      },
    });

    const invalidId = await PATCH(
      jsonRequest("/api/manual-entries/not-a-uuid", "PATCH", {
        description: "No service call",
      }),
      routeContext("not-a-uuid"),
    );
    expect(invalidId.status).toBe(400);
    expect(updateManualEntry).not.toHaveBeenCalled();
  });
});
