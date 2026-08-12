import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/dashboard/service", () => {
  class DashboardServiceError extends Error {
    constructor(
      public readonly status: 400 | 401 | 403,
      message: string,
      public readonly fields?: Record<string, string[]>,
    ) {
      super(message);
    }
  }
  return {
    DashboardServiceError,
    getDashboardApiContext: vi.fn(),
    readDashboard: vi.fn(),
    toDashboardApiErrorResponse: vi.fn((error: unknown) => {
      if (error instanceof DashboardServiceError) {
        return Response.json(
          {
            error: error.message,
            ...(error.fields ? { fields: error.fields } : {}),
          },
          { status: error.status },
        );
      }
      return Response.json({ error: "Invalid request." }, { status: 400 });
    }),
  };
});

import {
  DashboardServiceError,
  getDashboardApiContext,
  readDashboard,
} from "@/lib/dashboard/service";
import { GET } from "./route";

const actor = {
  supabase: {},
  userId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000001",
};

const familyModel = {
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
    excludedCount: 2,
  },
  trend: [{ date: "2026-08-12", incomeCents: 300000, spendingCents: 13750 }],
  categories: [
    {
      id: "cat-family",
      name: "Groceries",
      color: "#18745b",
      spendingCents: 13750,
      budgetCents: 10000,
      progressPercent: 137.5,
    },
  ],
  accounts: [
    {
      id: "account-family",
      name: "Household Chequing",
      mask: "1234",
      subtype: "chequing" as const,
      availableCents: 192500,
      currentCents: 200000,
      freshnessAt: "2026-08-12T12:00:00.000Z",
    },
    {
      id: "account-no-available",
      name: "Family Credit",
      mask: "9876",
      subtype: "credit_card" as const,
      availableCents: null,
      currentCents: -4250,
      freshnessAt: "2026-08-12T12:00:00.000Z",
    },
  ],
  transactions: [
    {
      id: "family-posted",
      source: "plaid" as const,
      scope: "family" as const,
      accountId: "account-family",
      accountName: "Household Chequing",
      merchantOrDescription: "Green Market",
      category: { id: "cat-family", name: "Groceries", color: "#18745b" },
      amountCents: -13750,
      date: "2026-08-12",
      pending: false,
      kind: "spending" as const,
      excluded: false,
    },
  ],
  filterOptions: {
    accounts: [{ id: "account-family", name: "Household Chequing" }],
    categories: [{ id: "cat-family", name: "Groceries" }],
  },
};

function request(query: string) {
  return new Request(`http://localhost/api/dashboard?${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDashboardApiContext).mockResolvedValue(actor as never);
  vi.mocked(readDashboard).mockResolvedValue(familyModel as never);
});

describe("GH-9 dashboard route acceptance", () => {
  it("API-001 returns the Family calendar-month model and Family rows only", async () => {
    const response = await GET(
      request("scope=family&period=month&reference=2026-08-12"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      scope: "family",
      range: { startDate: "2026-08-01", endDate: "2026-08-31" },
      summary: {
        incomeCents: 300000,
        spendingCents: 13750,
        netFlowCents: 286250,
      },
    });
    expect(body.transactions).toEqual([
      expect.objectContaining({ id: "family-posted", scope: "family" }),
    ]);
  });

  it("API-002 returns only the signed-in member's Personal rows", async () => {
    const personal = {
      ...familyModel,
      scope: "personal" as const,
      transactions: [
        {
          ...familyModel.transactions[0],
          id: "member-a",
          scope: "personal" as const,
        },
      ],
    };
    vi.mocked(readDashboard).mockResolvedValue(personal as never);
    const response = await GET(
      request("scope=personal&period=month&reference=2026-08-12"),
    );
    const body = await response.json();
    expect(body.scope).toBe("personal");
    expect(body.transactions.map((row: { id: string }) => row.id)).toEqual([
      "member-a",
    ]);
    expect(JSON.stringify(body)).not.toContain("member-b");
  });

  it("API-003 applies account, category, and pending filters consistently to every aggregate", async () => {
    const filtered = {
      ...familyModel,
      summary: {
        ...familyModel.summary,
        incomeCents: 0,
        spendingCents: 2500,
        netFlowCents: -2500,
        pendingAmountCents: 2500,
        pendingCount: 1,
        includedCount: 1,
      },
      trend: [{ date: "2026-08-12", incomeCents: 0, spendingCents: 2500 }],
      categories: [
        {
          ...familyModel.categories[0],
          spendingCents: 2500,
          progressPercent: 25,
        },
      ],
      transactions: [
        {
          ...familyModel.transactions[0],
          id: "pending-filtered",
          amountCents: -2500,
          pending: true,
        },
      ],
    };
    vi.mocked(readDashboard).mockResolvedValue(filtered as never);
    const response = await GET(
      request(
        "scope=family&period=month&reference=2026-08-12&accountId=account-family&categoryId=cat-family&status=pending",
      ),
    );
    const body = await response.json();
    expect(body.transactions).toHaveLength(1);
    expect(body.summary.spendingCents).toBe(2500);
    expect(body.trend[0].spendingCents).toBe(2500);
    expect(body.categories[0].spendingCents).toBe(2500);
  });

  it("API-004 reveals transfers and excluded rows for inclusion=all without adding them to totals", async () => {
    const visible = {
      ...familyModel,
      transactions: [
        familyModel.transactions[0],
        {
          ...familyModel.transactions[0],
          id: "transfer",
          kind: "transfer" as const,
          amountCents: -50000,
        },
        {
          ...familyModel.transactions[0],
          id: "excluded",
          excluded: true,
          amountCents: -9000,
        },
      ],
    };
    vi.mocked(readDashboard)
      .mockResolvedValueOnce(familyModel as never)
      .mockResolvedValueOnce(visible as never);
    const normal = await (
      await GET(request("scope=family&period=month&reference=2026-08-12"))
    ).json();
    const all = await (
      await GET(
        request("scope=family&period=month&reference=2026-08-12&inclusion=all"),
      )
    ).json();
    expect(normal.transactions.map((row: { id: string }) => row.id)).toEqual([
      "family-posted",
    ]);
    expect(all.transactions).toHaveLength(3);
    expect(all.summary).toEqual(normal.summary);
  });

  it("API-005 aggregates the complete stable paged result before applying limit=10", async () => {
    const complete = {
      ...familyModel,
      summary: {
        ...familyModel.summary,
        includedCount: 137,
        spendingCents: 13700,
      },
      transactions: Array.from({ length: 10 }, (_, index) => ({
        ...familyModel.transactions[0],
        id: `row-${index}`,
      })),
    };
    vi.mocked(readDashboard).mockResolvedValue(complete as never);
    const body = await (
      await GET(
        request("scope=family&period=month&reference=2026-08-12&limit=10"),
      )
    ).json();
    expect(body.transactions).toHaveLength(10);
    expect(body.summary.includedCount).toBe(137);
    expect(body.summary.spendingCents).toBe(13700);
  });

  it("API-006 rejects invalid period, date, custom range, timezone, search, and limit fields", async () => {
    vi.mocked(readDashboard).mockRejectedValue(
      new DashboardServiceError(400, "Invalid request.", {
        reference: ["Use YYYY-MM-DD."],
        from: ["Required for custom periods."],
        to: ["Must not precede from."],
        timeZone: ["Use the configured Canadian timezone."],
        search: ["Must be at most 100 characters."],
        limit: ["Must be between 1 and 100."],
      }),
    );
    const response = await GET(
      request(
        `scope=family&period=custom&reference=bad&from=2026-08-13&to=2026-08-12&search=${"x".repeat(101)}&limit=101`,
      ),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        error: "Invalid request.",
        fields: expect.objectContaining({
          reference: expect.any(Array),
          from: expect.any(Array),
          to: expect.any(Array),
          search: expect.any(Array),
          limit: expect.any(Array),
        }),
      }),
    );
  });

  it("API-007 performs case-insensitive merchant and account-name search with matching totals", async () => {
    const searched = {
      ...familyModel,
      summary: { ...familyModel.summary, includedCount: 1 },
      transactions: [
        {
          ...familyModel.transactions[0],
          merchantOrDescription: "GREEN MARKET",
        },
      ],
    };
    vi.mocked(readDashboard).mockResolvedValue(searched as never);
    const body = await (
      await GET(
        request(
          "scope=family&period=month&reference=2026-08-12&search=green%20market",
        ),
      )
    ).json();
    expect(body.transactions).toEqual([
      expect.objectContaining({ merchantOrDescription: "GREEN MARKET" }),
    ]);
    expect(body.summary.includedCount).toBe(1);
  });

  it("API-008 returns cached integer-cent balances, freshness, and null available balance without fabrication", async () => {
    const body = await (
      await GET(request("scope=family&period=month&reference=2026-08-12"))
    ).json();
    expect(body.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "account-family",
          availableCents: 192500,
          currentCents: 200000,
          freshnessAt: "2026-08-12T12:00:00.000Z",
        }),
        expect.objectContaining({
          id: "account-no-available",
          availableCents: null,
          currentCents: -4250,
        }),
      ]),
    );
  });

  it("API-009 returns 401 without any financial payload when no user is authenticated", async () => {
    vi.mocked(getDashboardApiContext).mockRejectedValue(
      new DashboardServiceError(401, "Sign in to continue."),
    );
    const response = await GET(
      request("scope=family&period=month&reference=2026-08-12"),
    );
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: "Sign in to continue." });
    expect(JSON.stringify(body)).not.toMatch(
      /transactions|accounts|summary|balance/i,
    );
    expect(readDashboard).not.toHaveBeenCalled();
  });
});
