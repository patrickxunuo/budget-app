import "server-only";

import { NextResponse } from "next/server";
import {
  CategoryServiceError,
  getApiContext,
  type CategoryContext,
} from "@/lib/categories/service";
import {
  manualEntryToAccountingTransaction,
  plaidViewToAccountingTransaction,
  resolveAccountingLine,
} from "@/lib/transactions/accounting";

export type TransactionDetailSource = "plaid" | "manual";

export type TransactionDetail = {
  id: string;
  source: TransactionDetailSource;
  date: string;
  merchantOrDescription: string;
  description: string | null;
  amountCents: number;
  accountName: string | null;
  scope: "family" | "personal";
  state: "posted" | "pending";
  kind: "income" | "spending" | "transfer" | "refund";
  originalCategory: { primary: string; detailed: string } | null;
  effectiveCategory: string | null;
  excluded: boolean;
  notes: string | null;
};

export type TransactionDetailApiContext = CategoryContext;

export class TransactionDetailServiceError extends Error {
  constructor(
    public readonly status: 404 | 500,
    message: string,
  ) {
    super(message);
  }
}

type CategoryValue = { id: string; name: string };
type PlaidMetadata = {
  kind_override: TransactionDetail["kind"] | null;
  note: string | null;
  excluded: boolean;
  categories: CategoryValue | CategoryValue[] | null;
};
type PlaidRow = {
  id: string;
  amount: number | string;
  transaction_date: string;
  merchant_name: string | null;
  name: string;
  pending: boolean;
  provider_payload: unknown;
  accounts:
    | {
        name: string;
        display_name: string | null;
        scope: TransactionDetail["scope"];
      }
    | Array<{
        name: string;
        display_name: string | null;
        scope: TransactionDetail["scope"];
      }>;
  transaction_metadata: PlaidMetadata | PlaidMetadata[] | null;
};
type ManualRow = {
  id: string;
  scope: TransactionDetail["scope"];
  kind: Exclude<TransactionDetail["kind"], "transfer">;
  amount: number | string;
  entry_date: string;
  description: string;
  notes: string | null;
  category_id: string;
  deleted_at: string | null;
  categories: CategoryValue | CategoryValue[] | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function originalCategory(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const category = (payload as { personalFinanceCategory?: unknown })
    .personalFinanceCategory;
  if (!category || typeof category !== "object") return null;
  const { primary, detailed } = category as {
    primary?: unknown;
    detailed?: unknown;
  };
  return typeof primary === "string" && typeof detailed === "string"
    ? { primary, detailed }
    : null;
}

function unavailable(): never {
  throw new TransactionDetailServiceError(
    500,
    "Transaction details are temporarily unavailable.",
  );
}

export async function getTransactionDetailApiContext() {
  return getApiContext();
}

export async function readTransactionDetail(
  ctx: TransactionDetailApiContext,
  source: TransactionDetailSource,
  id: string,
): Promise<TransactionDetail> {
  if (source === "plaid") {
    const { data, error } = await ctx.supabase
      .from("transactions")
      .select(
        "id,amount,transaction_date,merchant_name,name,pending,provider_payload,accounts!inner(name,display_name,scope),transaction_metadata(kind_override,note,excluded,categories(id,name))",
      )
      .eq("id", id)
      .eq("workspace_id", ctx.workspaceId)
      .is("removed_at", null)
      .maybeSingle();
    if (error) unavailable();
    if (!data)
      throw new TransactionDetailServiceError(404, "Transaction not found.");

    const row = data as unknown as PlaidRow;
    const account = one(row.accounts);
    if (!account) unavailable();
    const metadata = one(row.transaction_metadata);
    const category = one(metadata?.categories);
    const providerCategory = originalCategory(row.provider_payload);
    const line = resolveAccountingLine(
      plaidViewToAccountingTransaction({
        id: row.id,
        amount: Number(row.amount),
        transactionDate: row.transaction_date,
        pending: row.pending,
        name: row.name,
        originalPlaidCategory: providerCategory,
        effectiveCategory: category,
        kindOverride: metadata?.kind_override ?? null,
        excluded: metadata?.excluded ?? false,
      }),
    );

    return {
      id: row.id,
      source: "plaid",
      date: row.transaction_date,
      merchantOrDescription: row.merchant_name ?? row.name,
      description: row.name,
      amountCents: line.cashFlowCents,
      accountName: account.display_name ?? account.name,
      scope: account.scope,
      state: row.pending ? "pending" : "posted",
      kind: line.kind,
      originalCategory: providerCategory,
      effectiveCategory: category?.name ?? null,
      excluded: metadata?.excluded ?? false,
      notes: metadata?.note ?? null,
    };
  }

  const { data, error } = await ctx.supabase
    .from("manual_entries")
    .select(
      "id,scope,kind,amount,entry_date,description,notes,category_id,deleted_at,categories(id,name)",
    )
    .eq("id", id)
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) unavailable();
  if (!data)
    throw new TransactionDetailServiceError(404, "Transaction not found.");

  const row = data as unknown as ManualRow;
  const category = one(row.categories);
  const line = resolveAccountingLine(
    manualEntryToAccountingTransaction({
      id: row.id,
      amount:
        typeof row.amount === "number" ? row.amount.toFixed(2) : row.amount,
      currencyCode: "CAD",
      entryDate: row.entry_date,
      description: row.description,
      kind: row.kind,
      categoryId: row.category_id,
      deletedAt: row.deleted_at,
    }),
  );

  return {
    id: row.id,
    source: "manual",
    date: row.entry_date,
    merchantOrDescription: row.description,
    description: row.description,
    amountCents: line.cashFlowCents,
    accountName: null,
    scope: row.scope,
    state: "posted",
    kind: line.kind,
    originalCategory: null,
    effectiveCategory: category?.name ?? null,
    excluded: false,
    notes: row.notes,
  };
}

export function toTransactionDetailApiErrorResponse(error: unknown): Response {
  if (error instanceof CategoryServiceError) {
    return NextResponse.json(
      {
        error:
          error.status === 401
            ? "Sign in to continue."
            : error.status === 403
              ? "An active workspace membership is required."
              : "Transaction details are temporarily unavailable.",
      },
      { status: error.status },
    );
  }
  if (error instanceof TransactionDetailServiceError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }
  return NextResponse.json(
    { error: "Transaction details are temporarily unavailable." },
    { status: 500 },
  );
}
