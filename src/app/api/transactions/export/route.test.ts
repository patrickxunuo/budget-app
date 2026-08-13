import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dashboard/service", () => ({
  getDashboardApiContext: vi.fn(),
  toDashboardApiErrorResponse: vi.fn(
    (error: { status?: number; message?: string }) =>
      Response.json(
        { error: error.message ?? "Export failed." },
        { status: error.status ?? 500 },
      ),
  ),
}));
vi.mock("@/lib/transactions/csv-export", () => ({
  buildTransactionExport: vi.fn(),
}));

import { getDashboardApiContext } from "@/lib/dashboard/service";
import { buildTransactionExport } from "@/lib/transactions/csv-export";
import { GET } from "./route";

const actor = {
  userId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000001",
  supabase: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDashboardApiContext).mockResolvedValue(actor as never);
  vi.mocked(buildTransactionExport).mockResolvedValue({
    csv: "\uFEFFdate,description\r\n2026-08-13,Groceries\r\n",
    filename: "budget-app-family-2026-08-01-to-2026-08-31.csv",
  });
});

describe("GH-12 GET /api/transactions/export", () => {
  it("API-001 forwards every active Family filter and returns a complete downloadable UTF-8 CSV", async () => {
    const url =
      "http://localhost/api/transactions/export?scope=family&period=custom&reference=2026-08-13&from=2026-08-01&to=2026-08-31&accountId=30000000-0000-4000-8000-000000000001&categoryId=30000000-0000-4000-8000-000000000002&status=pending&inclusion=all&search=green";
    const response = await GET(new Request(url));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(
      /^text\/csv;\s*charset=utf-8$/i,
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="budget-app-family-2026-08-01-to-2026-08-31.csv"',
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder("utf-8").decode(bytes)).toContain(
      "date,description",
    );
    expect(buildTransactionExport).toHaveBeenCalledExactlyOnceWith(
      actor,
      expect.any(URLSearchParams),
    );
    expect(
      Object.fromEntries(
        vi.mocked(buildTransactionExport).mock.calls[0]![1] as URLSearchParams,
      ),
    ).toMatchObject({
      scope: "family",
      period: "custom",
      reference: "2026-08-13",
      from: "2026-08-01",
      to: "2026-08-31",
      accountId: "30000000-0000-4000-8000-000000000001",
      categoryId: "30000000-0000-4000-8000-000000000002",
      status: "pending",
      inclusion: "all",
      search: "green",
    });
  });

  it("API-002 forwards Personal scope with the authenticated actor boundary intact", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/transactions/export?scope=personal&period=month&reference=2026-08-13&status=all&inclusion=default",
      ),
    );
    expect(response.status).toBe(200);
    expect(buildTransactionExport).toHaveBeenCalledWith(
      expect.objectContaining({ userId: actor.userId }),
      expect.any(URLSearchParams),
    );
    expect(
      (
        vi.mocked(buildTransactionExport).mock.calls[0]![1] as URLSearchParams
      ).get("scope"),
    ).toBe("personal");
  });

  it.each([
    "scope=combined&period=month&reference=2026-08-13",
    "scope=family&period=century&reference=2026-08-13",
    "scope=family&period=month&reference=not-a-date",
    "scope=family&period=month&reference=2026-08-13&unknown=true",
  ])(
    "API-004 rejects invalid or unknown query input without a CSV body: %s",
    async (query) => {
      vi.mocked(buildTransactionExport).mockRejectedValueOnce(
        Object.assign(new Error("Invalid export filters."), { status: 400 }),
      );
      const response = await GET(
        new Request(`http://localhost/api/transactions/export?${query}`),
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(await response.json()).toEqual({
        error: "Invalid export filters.",
      });
    },
  );

  it.each([401, 403])(
    "API-005 returns %i JSON for an unavailable membership and never emits records",
    async (status) => {
      vi.mocked(getDashboardApiContext).mockRejectedValueOnce(
        Object.assign(new Error("Not authorized."), { status }),
      );
      const response = await GET(
        new Request(
          "http://localhost/api/transactions/export?scope=family&period=month&reference=2026-08-13",
        ),
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(await response.text()).not.toContain("Groceries");
      expect(buildTransactionExport).not.toHaveBeenCalled();
    },
  );
});
