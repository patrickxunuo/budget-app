import "server-only";

import { NextResponse } from "next/server";
import {
  CategoryServiceError,
  getApiContext,
  type CategoryContext,
} from "@/lib/categories/service";
import { collectAllPages } from "@/lib/supabase/pagination";
import {
  manualEntryToAccountingTransaction,
  plaidViewToAccountingTransaction,
  type AccountingTransaction,
} from "@/lib/transactions/accounting";
import { buildDashboardOverview, resolveTorontoMonth } from "./overview-domain";
import type {
  DashboardOverviewBudgetVersion,
  DashboardOverviewReadModel,
} from "./overview-types";
import type { DashboardScope } from "./types";

export type DashboardOverviewApiContext = CategoryContext;

export class DashboardOverviewServiceError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 500,
    message: string,
    public readonly fields?: Record<string, string[]>,
  ) {
    super(message);
  }
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
};

type CategoryValue = {
  id: string;
  name: string;
  color: string | null;
};

type CategoryRow = CategoryValue & { system_key: string | null };

type MetadataRow = {
  category_id: string | null;
  kind_override: "income" | "spending" | "transfer" | "refund" | null;
  excluded: boolean;
  categories: CategoryValue | CategoryValue[] | null;
};

type PlaidRow = {
  id: string;
  plaid_transaction_id: string;
  amount: number | string;
  transaction_date: string;
  name: string;
  pending: boolean;
  pending_transaction_id: string | null;
  provider_payload: unknown;
  transaction_metadata: MetadataRow | MetadataRow[] | null;
};

type ManualRow = {
  id: string;
  amount: number | string;
  entry_date: string;
  description: string;
  kind: "income" | "spending" | "refund";
  category_id: string;
  deleted_at: string | null;
};

type BudgetRow = {
  category_id: string;
  amount_cents: number | string;
  effective_month: string;
  end_month: string | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function safeCents(value: number | string | null) {
  if (value === null) return null;
  const cents = Number(value);
  if (!Number.isSafeInteger(cents)) {
    throw new DashboardOverviewServiceError(500, "Dashboard unavailable.");
  }
  return cents;
}

function providerCategory(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as { personalFinanceCategory?: unknown })
    .personalFinanceCategory;
  if (!value || typeof value !== "object") return null;
  const { primary, detailed } = value as {
    primary?: unknown;
    detailed?: unknown;
  };
  return typeof primary === "string" && typeof detailed === "string"
    ? { primary, detailed }
    : null;
}

export async function getDashboardOverviewApiContext() {
  return getApiContext();
}

export function toDashboardOverviewApiErrorResponse(error: unknown) {
  if (error instanceof DashboardOverviewServiceError) {
    return NextResponse.json(
      {
        error: error.message,
        ...(error.fields ? { fields: error.fields } : {}),
      },
      { status: error.status },
    );
  }
  if (error instanceof CategoryServiceError) {
    const status =
      error.status === 401 ? 401 : error.status === 403 ? 403 : 500;
    return NextResponse.json(
      {
        error:
          status === 401
            ? "Sign in to continue."
            : status === 403
              ? "An active workspace membership is required."
              : "Dashboard unavailable.",
      },
      { status },
    );
  }
  return NextResponse.json(
    { error: "Dashboard unavailable." },
    { status: 500 },
  );
}

export async function readDashboardOverview(
  ctx: DashboardOverviewApiContext,
  scope: DashboardScope,
  instant: Date | string | number = new Date(),
): Promise<DashboardOverviewReadModel> {
  const calendar = resolveTorontoMonth(instant);
  const currentMonth = calendar.range.startDate;

  const [
    accountRows,
    scopedCategories,
    familySystemCategories,
    budgetRows,
    plaidRows,
    manualRows,
  ] = await Promise.all([
    collectAllPages<AccountRow>(async (from, to) => {
      let query = ctx.supabase
        .from("accounts")
        .select(
          "id,name,display_name,mask,subtype,available_balance_cents,current_balance_cents,balance_updated_at,scope,owner_profile_id",
        )
        .eq("workspace_id", ctx.workspaceId)
        .is("archived_at", null);
      query = query.eq("scope", scope);
      query =
        scope === "personal"
          ? query.eq("owner_profile_id", ctx.userId)
          : query.is("owner_profile_id", null);
      const { data, error } = await query
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      if (error) {
        throw new DashboardOverviewServiceError(500, "Dashboard unavailable.");
      }
      return (data ?? []) as unknown as AccountRow[];
    }),
    collectAllPages<CategoryRow>(async (from, to) => {
      let query = ctx.supabase
        .from("categories")
        .select("id,name,color,system_key,scope,owner_profile_id")
        .eq("workspace_id", ctx.workspaceId)
        .is("archived_at", null);
      query = query.eq("scope", scope);
      query =
        scope === "personal"
          ? query.eq("owner_profile_id", ctx.userId)
          : query.is("owner_profile_id", null);
      const { data, error } = await query
        .order("id", { ascending: true })
        .range(from, to);
      if (error) {
        throw new DashboardOverviewServiceError(500, "Dashboard unavailable.");
      }
      return (data ?? []) as unknown as CategoryRow[];
    }),
    scope === "personal"
      ? collectAllPages<CategoryRow>(async (from, to) => {
          const { data, error } = await ctx.supabase
            .from("categories")
            .select("id,name,color,system_key,scope,owner_profile_id")
            .eq("workspace_id", ctx.workspaceId)
            .eq("scope", "family")
            .is("owner_profile_id", null)
            .not("system_key", "is", null)
            .is("archived_at", null)
            .order("id", { ascending: true })
            .range(from, to);
          if (error) {
            throw new DashboardOverviewServiceError(
              500,
              "Dashboard unavailable.",
            );
          }
          return (data ?? []) as unknown as CategoryRow[];
        })
      : Promise.resolve([] as CategoryRow[]),
    collectAllPages<BudgetRow>(async (from, to) => {
      let query = ctx.supabase
        .from("budgets")
        .select(
          "category_id,amount_cents,effective_month,end_month,scope,owner_profile_id",
        )
        .eq("workspace_id", ctx.workspaceId)
        .lte("effective_month", currentMonth)
        .or(`end_month.is.null,end_month.gte.${currentMonth}`);
      query = query.eq("scope", scope);
      query =
        scope === "personal"
          ? query.eq("owner_profile_id", ctx.userId)
          : query.is("owner_profile_id", null);
      const { data, error } = await query
        .order("effective_month", { ascending: true })
        .order("category_id", { ascending: true })
        .range(from, to);
      if (error) {
        throw new DashboardOverviewServiceError(500, "Dashboard unavailable.");
      }
      return (data ?? []) as unknown as BudgetRow[];
    }),
    collectAllPages<PlaidRow>(async (from, to) => {
      let query = ctx.supabase
        .from("transactions")
        .select(
          "id,plaid_transaction_id,amount,transaction_date,name,pending,pending_transaction_id,provider_payload,accounts!inner(scope,owner_profile_id),transaction_metadata(category_id,kind_override,excluded,categories(id,name,color))",
        )
        .eq("workspace_id", ctx.workspaceId)
        .eq("accounts.scope", scope)
        .is("removed_at", null)
        .gte("transaction_date", calendar.historyStartDate)
        .lte("transaction_date", calendar.asOfDate);
      query =
        scope === "personal"
          ? query.eq("accounts.owner_profile_id", ctx.userId)
          : query.is("accounts.owner_profile_id", null);
      const { data, error } = await query
        .order("transaction_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      if (error) {
        throw new DashboardOverviewServiceError(500, "Dashboard unavailable.");
      }
      return (data ?? []) as unknown as PlaidRow[];
    }),
    collectAllPages<ManualRow>(async (from, to) => {
      let query = ctx.supabase
        .from("manual_entries")
        .select(
          "id,amount,entry_date,description,kind,category_id,deleted_at,scope,owner_profile_id",
        )
        .eq("workspace_id", ctx.workspaceId)
        .gte("entry_date", calendar.historyStartDate)
        .lte("entry_date", calendar.asOfDate)
        .is("deleted_at", null);
      query = query.eq("scope", scope);
      query =
        scope === "personal"
          ? query.eq("owner_profile_id", ctx.userId)
          : query.is("owner_profile_id", null);
      const { data, error } = await query
        .order("entry_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      if (error) {
        throw new DashboardOverviewServiceError(500, "Dashboard unavailable.");
      }
      return (data ?? []) as unknown as ManualRow[];
    }),
  ]);

  const categoriesBySystemKey = new Map(
    [...scopedCategories, ...familySystemCategories]
      .filter((category) => category.system_key !== null)
      .map((category) => [category.system_key as string, category]),
  );
  const transactions: AccountingTransaction[] = plaidRows.map((row) => {
    const metadata = one(row.transaction_metadata);
    const originalCategory = providerCategory(row.provider_payload);
    const explicitCategory = one(metadata?.categories);
    const effectiveCategory =
      explicitCategory ??
      (originalCategory
        ? (categoriesBySystemKey.get(originalCategory.detailed) ??
          categoriesBySystemKey.get(originalCategory.primary) ??
          null)
        : null);
    return {
      ...plaidViewToAccountingTransaction({
        id: row.id,
        amount: Number(row.amount),
        transactionDate: row.transaction_date,
        pending: row.pending,
        name: row.name,
        originalPlaidCategory: originalCategory,
        effectiveCategory,
        kindOverride: metadata?.kind_override ?? null,
        excluded: metadata?.excluded ?? false,
      }),
      providerTransactionId: row.plaid_transaction_id,
      pendingTransactionId: row.pending_transaction_id,
    };
  });
  transactions.push(
    ...manualRows.map((row) =>
      manualEntryToAccountingTransaction({
        id: row.id,
        amount: String(row.amount),
        currencyCode: "CAD",
        entryDate: row.entry_date,
        description: row.description,
        kind: row.kind,
        categoryId: row.category_id,
        deletedAt: row.deleted_at,
      }),
    ),
  );

  const budgets: DashboardOverviewBudgetVersion[] = budgetRows.map((row) => ({
    categoryId: row.category_id,
    amountCents: safeCents(row.amount_cents) ?? 0,
    effectiveMonth: row.effective_month,
    endMonth: row.end_month,
  }));

  return buildDashboardOverview({
    scope,
    calendar,
    transactions,
    budgets,
    accounts: accountRows.map((account) => ({
      id: account.id,
      name: account.display_name ?? account.name,
      mask: account.mask,
      subtype: account.subtype,
      availableCents: safeCents(account.available_balance_cents),
      currentCents: safeCents(account.current_balance_cents),
      freshnessAt: account.balance_updated_at,
    })),
  });
}
