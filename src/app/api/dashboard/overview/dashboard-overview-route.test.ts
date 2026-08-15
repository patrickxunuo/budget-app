import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/dashboard/overview-service", () => {
  class DashboardOverviewServiceError extends Error {
    constructor(
      public readonly status: 400 | 401 | 403 | 500,
      message: string,
      public readonly fields?: Record<string, string[]>,
    ) {
      super(message);
    }
  }

  return {
    DashboardOverviewServiceError,
    getDashboardOverviewApiContext: vi.fn(),
    readDashboardOverview: vi.fn(),
    toDashboardOverviewApiErrorResponse: vi.fn((error: unknown) => {
      if (error instanceof DashboardOverviewServiceError) {
        return Response.json(
          {
            error: error.message,
            ...(error.fields ? { fields: error.fields } : {}),
          },
          { status: error.status },
        );
      }
      return Response.json(
        { error: "Dashboard unavailable." },
        { status: 500 },
      );
    }),
  };
});

import {
  DashboardOverviewServiceError,
  getDashboardOverviewApiContext,
  readDashboardOverview,
} from "@/lib/dashboard/overview-service";
import { GET } from "./route";

const actor = {
  supabase: {},
  userId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000001",
};

const familyModel = {
  scope: "family" as const,
  timeZone: "America/Toronto" as const,
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
    pace: "under" as const,
  },
  comparison: {
    baselineMonthCount: 3 as const,
    points: [
      {
        day: 1,
        date: "2026-08-01",
        currentCumulativeCents: 2_500,
        baselineAverageCents: 3_000,
      },
    ],
  },
  accounts: [
    {
      id: "account-family",
      name: "Household Chequing",
      mask: "1234",
      subtype: "chequing" as const,
      availableCents: 192_500,
      currentCents: 200_000,
      freshnessAt: "2026-08-12T12:00:00.000Z",
    },
  ],
};

function request(query: string) {
  return new Request(`http://localhost/api/dashboard/overview?${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDashboardOverviewApiContext).mockResolvedValue(actor as never);
  vi.mocked(readDashboardOverview).mockResolvedValue(familyModel as never);
});

describe("GH-31 dashboard overview route", () => {
  it("API-001 returns an authenticated Family overview with the request-current Toronto range", async () => {
    const response = await GET(request("scope=family"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      scope: "family",
      timeZone: "America/Toronto",
      asOfDate: "2026-08-12",
      range: { startDate: "2026-08-01", endDate: "2026-08-12" },
    });
    expect(readDashboardOverview).toHaveBeenCalledWith(
      actor,
      "family",
      expect.any(Date),
    );
  });

  it("API-002 passes Personal scope through the authenticated current-user boundary", async () => {
    const personal = { ...familyModel, scope: "personal" as const };
    vi.mocked(readDashboardOverview).mockResolvedValue(personal as never);

    const response = await GET(request("scope=personal"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ scope: "personal" });
    expect(getDashboardOverviewApiContext).toHaveBeenCalledTimes(1);
    expect(readDashboardOverview).toHaveBeenCalledWith(
      actor,
      "personal",
      expect.any(Date),
    );
  });

  it("API-003 rejects invalid, missing, and Combined scopes before any financial read", async () => {
    for (const query of ["scope=combined", "scope=workspace", ""]) {
      vi.mocked(readDashboardOverview).mockClear();
      const response = await GET(request(query));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Invalid request.",
        fields: { scope: ["Choose Family or Personal."] },
      });
      expect(readDashboardOverview).not.toHaveBeenCalled();
    }
  });

  it("API-004 maps missing authentication to 401 without returning financial data", async () => {
    vi.mocked(getDashboardOverviewApiContext).mockRejectedValue(
      new DashboardOverviewServiceError(401, "Sign in to continue."),
    );

    const response = await GET(request("scope=family"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Sign in to continue." });
    expect(JSON.stringify(body)).not.toMatch(
      /budget|account|balance|comparison/i,
    );
    expect(readDashboardOverview).not.toHaveBeenCalled();
  });

  it("API-005 sanitizes provider and database failures", async () => {
    vi.mocked(readDashboardOverview).mockRejectedValue(
      new Error("postgres password=secret relation financial_ledger failed"),
    );

    const response = await GET(request("scope=family"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Dashboard unavailable." });
    expect(JSON.stringify(body)).not.toMatch(
      /postgres|password|relation|secret/i,
    );
  });
});
