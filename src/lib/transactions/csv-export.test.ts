import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dashboard/service", () => ({ readDashboard: vi.fn() }));

import { readDashboard } from "@/lib/dashboard/service";
import {
  buildTransactionExport,
  serializeTransactionCsv,
  type CsvExportRow,
} from "./csv-export";

const baseRow: CsvExportRow = {
  date: "2026-08-13",
  description: "Green Market",
  merchant: "Green Market",
  amountCents: -4275,
  kind: "spending",
  category: "Groceries",
  account: "Household Chequing",
  pending: false,
  notes: "Weekly groceries",
  source: "plaid",
  inclusion: "included",
};

describe("GH-12 transaction CSV serialization", () => {
  it("API-001 emits the exact schema, signed CAD amounts, booleans, sources, inclusions, BOM, and CRLF", () => {
    const csv = serializeTransactionCsv([
      baseRow,
      {
        ...baseRow,
        date: "2026-08-12",
        description: "Cash tutoring",
        merchant: "",
        amountCents: 10000,
        kind: "income",
        account: "",
        pending: true,
        source: "manual",
        inclusion: "excluded",
      },
    ]);

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain(
      "date,description,merchant,amount,kind,category,account,pending,notes,source,inclusion\r\n",
    );
    expect(csv).toContain(",-42.75,spending,");
    expect(csv).toContain(",100.00,income,");
    expect(csv).toContain(",false,Weekly groceries,plaid,included");
    expect(csv).toContain(",true,Weekly groceries,manual,excluded");
    expect(csv.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("API-003 round-trips RFC 4180 quoting and UTF-8 without exposing fields outside CsvExportRow", () => {
    const csv = serializeTransactionCsv([
      {
        ...baseRow,
        description: 'Caf\u00e9, "Chez Nous"\r\nMontr\u00e9al',
        merchant: "\u6771\u4eac\u5e02\u5834",
        notes: "na\u00efve \ud83e\uded0",
      },
    ]);

    expect(csv).toContain('"Caf\u00e9, ""Chez Nous""\r\nMontr\u00e9al"');
    expect(csv).toContain("\u6771\u4eac\u5e02\u5834");
    expect(csv).toContain("na\u00efve \ud83e\uded0");
    expect(csv).not.toMatch(
      /access[_-]?token|owner[_-]?profile|authorization|provider_payload|workspace_id/i,
    );
  });

  it.each(["=1+1", "+SUM(A1:A2)", "-2+3", "@cmd", "\tformula", "\rformula"])(
    "API-003 neutralizes spreadsheet formula text %j while keeping trusted numeric amounts numeric",
    (formula) => {
      const csv = serializeTransactionCsv([
        {
          ...baseRow,
          description: `  ${formula}`,
          merchant: formula,
          notes: formula,
        },
      ]);

      expect(csv).toContain(`'${formula}`);
      expect(csv).toContain("-42.75");
      expect(csv).not.toContain("'-42.75");
    },
  );

  it("API-003 serializes transfer and superseded inclusion values without formula-corrupting signed amounts", () => {
    const csv = serializeTransactionCsv([
      { ...baseRow, amountCents: -1, inclusion: "transfer" },
      { ...baseRow, amountCents: 0, inclusion: "superseded" },
    ]);

    expect(csv).toContain("-0.01");
    expect(csv).toContain(",transfer\r\n");
    expect(csv).toContain(",superseded\r\n");
  });
});
describe("GH-12 complete scoped transaction export", () => {
  it("API-001 applies the shared Family filter schema before serialization and does not use the dashboard display limit", async () => {
    vi.mocked(readDashboard).mockResolvedValueOnce({
      scope: "family",
      period: "custom",
      range: { startDate: "2026-08-01", endDate: "2026-08-31" },
      transactions: [
        {
          id: "row-plaid",
          source: "plaid",
          scope: "family",
          accountId: "account-family",
          accountName: "Household Chequing",
          merchantOrDescription: "Green Market",
          category: { id: "category-grocery", name: "Groceries", color: null },
          amountCents: -4275,
          date: "2026-08-13",
          pending: false,
          kind: "spending",
          excluded: false,
        },
        {
          id: "row-manual",
          source: "manual",
          scope: "family",
          accountId: null,
          accountName: null,
          merchantOrDescription: "Cash tutoring",
          category: null,
          amountCents: 10000,
          date: "2026-08-12",
          pending: false,
          kind: "income",
          excluded: false,
        },
      ],
    } as never);
    const context = {
      userId: "10000000-0000-4000-8000-000000000001",
      workspaceId: "20000000-0000-4000-8000-000000000001",
      supabase: {},
    };

    const result = await buildTransactionExport(
      context as never,
      new URLSearchParams({
        scope: "family",
        period: "custom",
        reference: "2026-08-13",
        from: "2026-08-01",
        to: "2026-08-31",
        accountId: "30000000-0000-4000-8000-000000000001",
        categoryId: "30000000-0000-4000-8000-000000000002",
        status: "posted",
        inclusion: "default",
        search: "market",
      }),
    );

    expect(readDashboard).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        scope: "family",
        from: "2026-08-01",
        to: "2026-08-31",
        accountId: "30000000-0000-4000-8000-000000000001",
        categoryId: "30000000-0000-4000-8000-000000000002",
        status: "posted",
        inclusion: "default",
        search: "market",
        limit: expect.any(Number),
      }),
      { unlimited: true },
    );
    expect(
      (vi.mocked(readDashboard).mock.calls[0]![2] as { unlimited: boolean })
        .unlimited,
    ).toBe(true);
    expect(result.filename).toBe(
      "budget-app-family-2026-08-01-to-2026-08-31.csv",
    );
    expect(result.csv.indexOf("Green Market")).toBeLessThan(
      result.csv.indexOf("Cash tutoring"),
    );
    expect(result.csv).toContain(",plaid,included");
    expect(result.csv).toContain(",manual,included");
  });

  it("API-002 preserves Personal scope at the read boundary so another member and Family data cannot enter the export", async () => {
    vi.mocked(readDashboard).mockResolvedValueOnce({
      scope: "personal",
      period: "month",
      range: { startDate: "2026-08-01", endDate: "2026-08-31" },
      transactions: [],
    } as never);
    const context = {
      userId: "10000000-0000-4000-8000-000000000001",
      workspaceId: "20000000-0000-4000-8000-000000000001",
      supabase: {},
    };

    const result = await buildTransactionExport(context as never, {
      scope: "personal",
      period: "month",
      reference: "2026-08-13",
      status: "all",
      inclusion: "default",
    });

    expect(readDashboard).toHaveBeenCalledWith(
      expect.objectContaining({ userId: context.userId }),
      expect.objectContaining({ scope: "personal" }),
      { unlimited: true },
    );
    expect(result.csv).not.toContain("another member");
    expect(result.csv).not.toContain("Family private row");
  });
});
