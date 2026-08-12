import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  CategoryServiceError,
  getApiContext,
  type CategoryContext,
} from "@/lib/categories/service";
import { collectAllPages } from "@/lib/supabase/pagination";
import {
  getDateRange,
  manualEntryToAccountingTransaction,
  plaidViewToAccountingTransaction,
  reconcilePendingTransactions,
} from "@/lib/transactions/accounting";
import { aggregateDashboard, cadToCents, inclusionMatches } from "./domain";
import type {
  DashboardFilters,
  DashboardReadModel,
  DashboardTransaction,
} from "./types";
import { dashboardQuerySchema } from "./validation";
export type DashboardApiContext = CategoryContext;
export class DashboardServiceError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 500,
    message: string,
    public readonly fields?: Record<string, string[]>,
  ) {
    super(message);
  }
}
export async function getDashboardApiContext() {
  return getApiContext();
}
export function toDashboardApiErrorResponse(error: unknown) {
  if (error instanceof ZodError)
    return NextResponse.json(
      { error: "Invalid request.", fields: error.flatten().fieldErrors },
      { status: 400 },
    );
  if (error instanceof DashboardServiceError)
    return NextResponse.json(
      {
        error: error.message,
        ...(error.fields ? { fields: error.fields } : {}),
      },
      { status: error.status },
    );
  if (error instanceof CategoryServiceError) {
    return NextResponse.json(
      {
        error: error.status === 401 ? "Sign in to continue." : error.message,
      },
      { status: error.status },
    );
  }
  return NextResponse.json(
    { error: "Dashboard unavailable." },
    { status: 500 },
  );
}
type AccountRow = {
  id: string;
  name: string;
  display_name: string | null;
  mask: string | null;
  subtype: "chequing" | "savings" | "credit_card";
  available_balance_cents: number | string | null;
  current_balance_cents: number | string | null;
  balance_updated_at: string | null;
  scope: "family" | "personal";
  owner_profile_id: string | null;
};
type TxRow = {
  id: string;
  account_id: string;
  plaid_transaction_id: string;
  amount: number | string;
  transaction_date: string;
  merchant_name: string | null;
  name: string;
  pending: boolean;
  pending_transaction_id: string | null;
  provider_payload: unknown;
  accounts: AccountRow | AccountRow[];
  transaction_metadata:
    TransactionMetadataRow | TransactionMetadataRow[] | null;
};
type CategoryValue = { id: string; name: string; color: string | null };
type TransactionMetadataRow = {
  kind_override: "income" | "spending" | "transfer" | "refund" | null;
  excluded: boolean;
  categories: CategoryValue | CategoryValue[] | null;
};
type ManualRow = {
  id: string;
  scope: "family" | "personal";
  owner_profile_id: string | null;
  kind: "income" | "spending" | "refund";
  amount: string;
  entry_date: string;
  description: string;
  category_id: string;
  deleted_at: string | null;
  categories: CategoryValue | CategoryValue[] | null;
};
type BudgetRow = { category_id: string; amount: number | string };
type CategoryRow = CategoryValue & { system_key: string | null };
function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}
function nullableCents(value: number | string | null): number | null {
  if (value === null) return null;
  const cents = Number(value);
  if (!Number.isSafeInteger(cents)) {
    throw new DashboardServiceError(500, "Dashboard unavailable.");
  }
  return cents;
}
function personalFinanceCategory(
  payload: unknown,
): { primary: string; detailed: string } | null {
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
export async function readDashboard(
  ctx: DashboardApiContext,
  raw: URLSearchParams | Record<string, unknown>,
): Promise<DashboardReadModel> {
  let filters: DashboardFilters;
  try {
    filters = dashboardQuerySchema.parse(
      raw instanceof URLSearchParams ? Object.fromEntries(raw) : raw,
    );
  } catch (e) {
    if (e instanceof ZodError) throw e;
    throw new DashboardServiceError(400, "Invalid request.");
  }
  const timeZone = "America/Toronto";
  let range;
  try {
    range = getDateRange(
      filters.period,
      filters.reference,
      timeZone,
      filters.period === "custom"
        ? { startDate: filters.from!, endDate: filters.to! }
        : undefined,
    );
  } catch {
    throw new DashboardServiceError(400, "Invalid request.", {
      reference: ["Use YYYY-MM-DD."],
    });
  }
  const [
    accountsRaw,
    scopedCategoryRows,
    systemCategoryRows,
    budgetsRaw,
    txRows,
    manualRows,
  ] = await Promise.all([
    collectAllPages<AccountRow>(async (from, to) => {
      let query = ctx.supabase
        .from("accounts")
        .select(
          "id,name,display_name,mask,subtype,available_balance_cents,current_balance_cents,balance_updated_at,scope,owner_profile_id",
        )
        .eq("workspace_id", ctx.workspaceId)
        .eq("scope", filters.scope)
        .is("archived_at", null)
        .order("id", { ascending: true });
      query =
        filters.scope === "personal"
          ? query.eq("owner_profile_id", ctx.userId)
          : query.is("owner_profile_id", null);
      const { data, error } = await query.range(from, to);
      if (error) throw new DashboardServiceError(500, "Dashboard unavailable.");
      return (data ?? []) as unknown as AccountRow[];
    }),
    collectAllPages<CategoryRow>(async (from, to) => {
      let query = ctx.supabase
        .from("categories")
        .select("id,name,color,system_key,scope,owner_profile_id")
        .eq("workspace_id", ctx.workspaceId)
        .eq("scope", filters.scope)
        .is("archived_at", null)
        .order("id", { ascending: true });
      query =
        filters.scope === "personal"
          ? query.eq("owner_profile_id", ctx.userId)
          : query.is("owner_profile_id", null);
      const { data, error } = await query.range(from, to);
      if (error) throw new DashboardServiceError(500, "Dashboard unavailable.");
      return (data ?? []) as unknown as CategoryRow[];
    }),
    filters.scope === "personal"
      ? collectAllPages<CategoryRow>(async (from, to) => {
          const { data, error } = await ctx.supabase
            .from("categories")
            .select("id,name,color,system_key")
            .eq("workspace_id", ctx.workspaceId)
            .eq("scope", "family")
            .not("system_key", "is", null)
            .is("archived_at", null)
            .order("id", { ascending: true })
            .range(from, to);
          if (error)
            throw new DashboardServiceError(500, "Dashboard unavailable.");
          return (data ?? []) as unknown as CategoryRow[];
        })
      : Promise.resolve([] as CategoryRow[]),
    collectAllPages<BudgetRow>(async (from, to) => {
      let query = ctx.supabase
        .from("budgets")
        .select(
          "id,category_id,amount,start_date,end_date,scope,owner_profile_id",
        )
        .eq("workspace_id", ctx.workspaceId)
        .eq("scope", filters.scope)
        .is("archived_at", null)
        .lte("start_date", range.endDate)
        .gte("end_date", range.startDate)
        .order("id", { ascending: true });
      query =
        filters.scope === "personal"
          ? query.eq("owner_profile_id", ctx.userId)
          : query.is("owner_profile_id", null);
      const { data, error } = await query.range(from, to);
      if (error) throw new DashboardServiceError(500, "Dashboard unavailable.");
      return (data ?? []) as unknown as BudgetRow[];
    }),
    collectAllPages<TxRow>(async (from, to) => {
      let q = ctx.supabase
        .from("transactions")
        .select(
          "id,account_id,plaid_transaction_id,amount,transaction_date,merchant_name,name,pending,pending_transaction_id,provider_payload,accounts!inner(id,name,display_name,mask,subtype,scope,owner_profile_id),transaction_metadata(category_id,kind_override,excluded,categories(id,name,color))",
        )
        .eq("workspace_id", ctx.workspaceId)
        .eq("accounts.scope", filters.scope)
        .is("removed_at", null)
        .order("transaction_date", { ascending: false })
        .order("id", { ascending: true });
      if (filters.scope === "personal")
        q = q.eq("accounts.owner_profile_id", ctx.userId);
      else q = q.is("accounts.owner_profile_id", null);
      if (filters.accountId) q = q.eq("account_id", filters.accountId);
      const { data, error } = await q.range(from, to);
      if (error) throw new DashboardServiceError(500, "Dashboard unavailable.");
      return (data ?? []) as unknown as TxRow[];
    }),
    collectAllPages<ManualRow>(async (from, to) => {
      let q = ctx.supabase
        .from("manual_entries")
        .select(
          "id,scope,owner_profile_id,kind,amount,entry_date,description,category_id,deleted_at,categories(id,name,color)",
        )
        .eq("workspace_id", ctx.workspaceId)
        .eq("scope", filters.scope);
      q =
        filters.scope === "personal"
          ? q.eq("owner_profile_id", ctx.userId)
          : q.is("owner_profile_id", null);
      q = q
        .is("deleted_at", null)
        .gte("entry_date", range.startDate)
        .lte("entry_date", range.endDate)
        .order("entry_date", { ascending: false })
        .order("id", { ascending: true });
      const { data, error } = await q.range(from, to);
      if (error) throw new DashboardServiceError(500, "Dashboard unavailable.");
      return (data ?? []) as unknown as ManualRow[];
    }),
  ]);
  const accounts: DashboardReadModel["accounts"] = accountsRaw.map((a) => ({
    id: a.id,
    name: a.display_name ?? a.name,
    mask: a.mask,
    subtype: a.subtype,
    availableCents: nullableCents(a.available_balance_cents),
    currentCents: nullableCents(a.current_balance_cents),
    freshnessAt: a.balance_updated_at,
  }));
  const categoryRows = [
    ...new Map(
      [...scopedCategoryRows, ...systemCategoryRows].map((category) => [
        category.id,
        category,
      ]),
    ).values(),
  ];
  const categories = categoryRows.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
  }));
  const categoriesBySystemKey = new Map(
    categoryRows
      .filter((category) => category.system_key)
      .map((category) => [category.system_key, category]),
  );
  const plaidAccounting = txRows.map((r) => {
    const md = one<TransactionMetadataRow>(r.transaction_metadata);
    const providerCategory = personalFinanceCategory(r.provider_payload);
    return {
      ...plaidViewToAccountingTransaction({
        id: r.id,
        amount: Number(r.amount),
        transactionDate: r.transaction_date,
        pending: r.pending,
        name: r.name,
        originalPlaidCategory: providerCategory,
        effectiveCategory: one<CategoryValue>(md?.categories),
        kindOverride: md?.kind_override ?? null,
        excluded: md?.excluded ?? false,
      }),
      providerTransactionId: r.plaid_transaction_id,
      pendingTransactionId: r.pending_transaction_id,
    };
  });
  const visibleManualRows = filters.accountId ? [] : manualRows;
  const manualAccounting = visibleManualRows.map((r) =>
    manualEntryToAccountingTransaction({
      id: r.id,
      amount: String(r.amount),
      currencyCode: "CAD",
      entryDate: r.entry_date,
      description: r.description,
      kind: r.kind,
      categoryId: r.category_id,
      deletedAt: r.deleted_at,
    }),
  );
  const lines = reconcilePendingTransactions([
    ...plaidAccounting,
    ...manualAccounting,
  ]);
  const lineById = new Map(lines.map((l) => [l.id, l]));
  let rows: DashboardTransaction[] = [
    ...txRows.map((r) => {
      const a = one<AccountRow>(r.accounts)!;
      const md = one<TransactionMetadataRow>(r.transaction_metadata);
      const manualCategory = one<CategoryValue>(md?.categories);
      const providerCategory = personalFinanceCategory(r.provider_payload);
      const c =
        manualCategory ??
        (providerCategory
          ? (categoriesBySystemKey.get(providerCategory.detailed) ??
            categoriesBySystemKey.get(providerCategory.primary))
          : null);
      const l = lineById.get(r.id)!;
      return {
        id: r.id,
        source: "plaid" as const,
        scope: filters.scope,
        accountId: a.id,
        accountName: a.display_name ?? a.name,
        merchantOrDescription: r.merchant_name ?? r.name,
        category: c ? { id: c.id, name: c.name, color: c.color } : null,
        amountCents: l.cashFlowCents,
        date: r.transaction_date,
        pending: r.pending,
        kind: l.kind,
        excluded: l.inclusion === "excluded",
      };
    }),
    ...visibleManualRows.map((r) => {
      const c = one<CategoryValue>(r.categories);
      const l = lineById.get(r.id)!;
      return {
        id: r.id,
        source: "manual" as const,
        scope: r.scope,
        accountId: null,
        accountName: null,
        merchantOrDescription: r.description,
        category: c ? { id: c.id, name: c.name, color: c.color } : null,
        amountCents: l.cashFlowCents,
        date: r.entry_date,
        pending: false,
        kind: l.kind,
        excluded: false,
      };
    }),
  ];
  rows = rows.filter((row) => lineById.get(row.id)?.inclusion !== "superseded");
  rows = rows.filter(
    (row) => row.date >= range.startDate && row.date <= range.endDate,
  );
  if (filters.categoryId)
    rows = rows.filter((r) => r.category?.id === filters.categoryId);
  if (filters.status !== "all")
    rows = rows.filter((r) =>
      filters.status === "pending" ? r.pending : !r.pending,
    );
  if (filters.search) {
    const s = filters.search.toLocaleLowerCase("en-CA");
    rows = rows.filter(
      (r) =>
        r.merchantOrDescription.toLocaleLowerCase("en-CA").includes(s) ||
        r.accountName?.toLocaleLowerCase("en-CA").includes(s),
    );
  }
  const aggregateRows = rows;
  rows = rows.filter((r) => inclusionMatches(r, filters.inclusion));
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return aggregateDashboard({
    scope: filters.scope,
    period: filters.period,
    range,
    timeZone,
    rows,
    categories: filters.categoryId
      ? categories.filter((category) => category.id === filters.categoryId)
      : categories,
    budgets: budgetsRaw.map((b) => ({
      categoryId: b.category_id,
      amountCents: cadToCents(b.amount),
    })),
    accounts: filters.accountId
      ? accounts.filter((account) => account.id === filters.accountId)
      : accounts,
    filterAccounts: accounts,
    filterCategories: categories,
    limit: filters.limit,
    aggregateRows,
  });
}
