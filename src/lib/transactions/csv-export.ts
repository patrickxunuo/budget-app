import "server-only";

import { dashboardExportQuerySchema } from "@/lib/dashboard/validation";
import {
  readDashboard,
  type DashboardApiContext,
} from "@/lib/dashboard/service";

export type CsvExportRow = {
  date: string;
  description: string;
  merchant: string;
  amountCents: number;
  kind: "income" | "spending" | "transfer" | "refund";
  category: string;
  account: string;
  pending: boolean;
  notes: string;
  source: "plaid" | "manual";
  inclusion: "included" | "transfer" | "excluded" | "superseded";
};

const FORMULA_PREFIX = /^[\s]*[=+\-@\t\r]/;
function textCell(value: string): string {
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function serializeTransactionCsv(rows: readonly CsvExportRow[]): string {
  const header =
    "date,description,merchant,amount,kind,category,account,pending,notes,source,inclusion";
  const lines = rows.map((row) =>
    [
      textCell(row.date),
      textCell(row.description),
      textCell(row.merchant),
      (row.amountCents / 100).toFixed(2),
      row.kind,
      textCell(row.category),
      textCell(row.account),
      String(row.pending),
      textCell(row.notes),
      row.source,
      row.inclusion,
    ].join(","),
  );
  return `\uFEFF${[header, ...lines].join("\r\n")}\r\n`;
}

export async function buildTransactionExport(
  ctx: DashboardApiContext,
  raw: URLSearchParams | Record<string, unknown>,
): Promise<{ csv: string; filename: string }> {
  const values = raw instanceof URLSearchParams ? Object.fromEntries(raw) : raw;
  const filters = dashboardExportQuerySchema.parse(values);
  const model = await readDashboard(
    ctx,
    { ...filters, limit: 100 },
    { unlimited: true },
  );
  const rows: CsvExportRow[] = model.transactions.map((row) => ({
    date: row.date,
    description: row.merchantOrDescription,
    merchant:
      row.merchant ?? (row.source === "plaid" ? row.merchantOrDescription : ""),
    amountCents: row.amountCents,
    kind: row.kind,
    category: row.category?.name ?? "Uncategorized",
    account: row.accountName ?? "",
    pending: row.pending,
    notes: row.notes ?? "",
    source: row.source,
    inclusion:
      row.inclusion ??
      (row.excluded
        ? "excluded"
        : row.kind === "transfer"
          ? "transfer"
          : "included"),
  }));
  return {
    csv: serializeTransactionCsv(rows),
    filename: `budget-app-${filters.scope}-${model.range.startDate}-to-${model.range.endDate}.csv`,
  };
}
