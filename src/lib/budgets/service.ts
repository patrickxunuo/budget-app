import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  getApiContext,
  listTransactions,
  type CategoryContext,
  CategoryServiceError,
} from "@/lib/categories/service";
import { listManualEntries } from "@/lib/manual-entries/service";
import { collectAllPages } from "@/lib/supabase/pagination";
import {
  calculateSummary,
  manualEntryToAccountingTransaction,
  plaidViewToAccountingTransaction,
} from "@/lib/transactions/accounting";
import { calculateBudgetProgress, monthEnd, sumBudgetProgress } from "./domain";
import type { BudgetMonthReadModel, BudgetScope, BudgetTarget } from "./types";

export type BudgetContext = CategoryContext;
export class BudgetServiceError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 500,
    message: string,
    public readonly fields?: Record<string, string[]>,
  ) {
    super(message);
  }
}
type DbError = { code?: string; message?: string } | null;
type BudgetRow = {
  id: string;
  category_id: string;
  amount_cents: number | string;
  currency_code: string;
  effective_month: string;
  end_month: string | null;
  scope: BudgetScope;
  owner_profile_id: string | null;
  archived_at: string | null;
  categories?:
    | { name: string; color: string | null }
    | Array<{ name: string; color: string | null }>
    | null;
};
type CategoryRow = { id: string; name: string; color: string | null };
const one = <T>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
function safeCents(value: number | string): number {
  const cents = Number(value);
  if (!Number.isSafeInteger(cents))
    throw new BudgetServiceError(500, "Budgets unavailable.");
  return cents;
}
function target(row: BudgetRow): BudgetTarget {
  const category = one(row.categories);
  if (!category)
    throw new BudgetServiceError(500, "Budget category unavailable.");
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: category.name,
    categoryColor: category.color,
    scope: row.scope,
    amountCents: safeCents(row.amount_cents),
    currencyCode: "CAD",
    effectiveMonth: row.effective_month,
    endMonth: row.end_month,
    archived: row.archived_at !== null,
  };
}
function dbError(error: DbError): never {
  if (error?.code === "23P01" || error?.code === "23505")
    throw new BudgetServiceError(
      409,
      "A target already applies to this category and month.",
    );
  if (error?.code === "42501")
    throw new BudgetServiceError(
      403,
      "An active family membership is required.",
    );
  if (error?.code === "23503")
    throw new BudgetServiceError(400, "Invalid request.", {
      categoryId: ["Choose an active category in the same privacy scope."],
    });
  if (
    error?.code === "22023" ||
    error?.code === "23514" ||
    error?.code === "22003"
  )
    throw new BudgetServiceError(400, "Invalid request.");
  throw new BudgetServiceError(500, "Budgets unavailable.");
}
export async function getBudgetApiContext(): Promise<BudgetContext> {
  return getApiContext();
}
function scoped<
  T extends {
    eq: (column: string, value: unknown) => T;
    is: (column: string, value: null) => T;
  },
>(query: T, ctx: BudgetContext, scope: BudgetScope): T {
  const q = query.eq("scope", scope);
  return scope === "personal"
    ? q.eq("owner_profile_id", ctx.userId)
    : q.is("owner_profile_id", null);
}
async function applicableRows(
  ctx: BudgetContext,
  scope: BudgetScope,
  month: string,
): Promise<BudgetRow[]> {
  return collectAllPages<BudgetRow>(async (from, to) => {
    let query = ctx.supabase
      .from("budgets")
      .select(
        "id,category_id,amount_cents,currency_code,effective_month,end_month,scope,owner_profile_id,archived_at,categories!inner(name,color)",
      )
      .eq("workspace_id", ctx.workspaceId)
      .lte("effective_month", month)
      .or(`end_month.is.null,end_month.gte.${month}`)
      .order("effective_month", { ascending: true })
      .order("id", { ascending: true });
    query = scoped(query, ctx, scope);
    const { data, error } = await query.range(from, to);
    if (error) dbError(error);
    return (data ?? []) as unknown as BudgetRow[];
  });
}
export async function readBudgetMonth(
  ctx: BudgetContext,
  scope: BudgetScope,
  month: string,
): Promise<BudgetMonthReadModel> {
  const end = monthEnd(month);
  const [rows, categories, plaid, manual] = await Promise.all([
    applicableRows(ctx, scope, month),
    collectAllPages<CategoryRow>(async (from, to) => {
      let q = ctx.supabase
        .from("categories")
        .select("id,name,color,scope,owner_profile_id")
        .eq("workspace_id", ctx.workspaceId)
        .is("archived_at", null)
        .order("name")
        .order("id");
      q = scoped(q, ctx, scope);
      const { data, error } = await q.range(from, to);
      if (error) dbError(error);
      return (data ?? []) as CategoryRow[];
    }),
    listTransactions(ctx, undefined, undefined, {
      scope,
      from: month,
      to: end,
    }),
    listManualEntries(ctx, { scope, from: month, to: end }),
  ]);
  const accounting = [
    ...plaid.map((row) => plaidViewToAccountingTransaction(row)),
    ...manual.map((row) =>
      manualEntryToAccountingTransaction({
        id: row.id,
        amount: row.amount,
        currencyCode: row.currencyCode,
        entryDate: row.entryDate,
        description: row.description,
        kind: row.kind,
        categoryId: row.categoryId,
        deletedAt: row.deletedAt,
      }),
    ),
  ];
  const summary = calculateSummary(accounting, {
    startDate: month,
    endDate: end,
  });
  const budgets = rows.map(target).map((value) => {
    const progress = calculateBudgetProgress(
      value,
      summary.categorySpendingCents[value.categoryId] ?? 0,
    );
    return {
      ...progress,
      percentageUsed: Math.round(progress.percentageUsed * 100) / 100,
    };
  });
  const targeted = new Set(budgets.map((b) => b.categoryId));
  return {
    scope,
    month,
    monthEnd: end,
    currencyCode: "CAD",
    budgets,
    availableCategories: categories.filter((c) => !targeted.has(c.id)),
    summary: sumBudgetProgress(budgets),
  };
}
async function targetById(
  ctx: BudgetContext,
  id: string,
): Promise<BudgetTarget | null> {
  const { data, error } = await ctx.supabase
    .from("budgets")
    .select(
      "id,category_id,amount_cents,currency_code,effective_month,end_month,scope,owner_profile_id,archived_at,categories!inner(name,color)",
    )
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) dbError(error);
  return data ? target(data as unknown as BudgetRow) : null;
}
export async function createBudget(
  ctx: BudgetContext,
  input: {
    scope: BudgetScope;
    categoryId: string;
    amountCents: number;
    effectiveMonth: string;
  },
) {
  const { data, error } = await ctx.supabase.rpc("create_budget_target", {
    p_scope: input.scope,
    p_category_id: input.categoryId,
    p_amount_cents: input.amountCents,
    p_effective_month: input.effectiveMonth,
  });
  if (error) dbError(error);
  const row = data as unknown as BudgetRow | null;
  if (!row) dbError(null);
  return (await targetById(ctx, row!.id))!;
}
export async function updateBudget(
  ctx: BudgetContext,
  id: string,
  input:
    | { amountCents: number; effectiveMonth: string }
    | { archived: true; effectiveMonth: string },
) {
  const archive = "archived" in input;
  const { data, error } = archive
    ? await ctx.supabase.rpc("archive_budget_target", {
        p_id: id,
        p_effective_month: input.effectiveMonth,
      })
    : await ctx.supabase.rpc("revise_budget_target", {
        p_id: id,
        p_amount_cents: input.amountCents,
        p_effective_month: input.effectiveMonth,
      });
  if (error) dbError(error);
  const row = data as unknown as BudgetRow | null;
  if (!row) throw new BudgetServiceError(404, "Budget target not found.");
  return (await targetById(ctx, row.id))!;
}
export async function inspectBudgetHistory(
  ctx: BudgetContext,
  id: string,
  month: string,
) {
  const seed = await targetById(ctx, id);
  if (!seed) throw new BudgetServiceError(404, "Budget target not found.");
  const rows = await collectAllPages<BudgetRow>(async (from, to) => {
    let query = ctx.supabase
      .from("budgets")
      .select(
        "id,category_id,amount_cents,currency_code,effective_month,end_month,scope,owner_profile_id,archived_at,categories!inner(name,color)",
      )
      .eq("workspace_id", ctx.workspaceId)
      .eq("category_id", seed.categoryId)
      .eq("scope", seed.scope)
      .order("effective_month", { ascending: true })
      .order("id", { ascending: true });
    query =
      seed.scope === "personal"
        ? query.eq("owner_profile_id", ctx.userId)
        : query.is("owner_profile_id", null);
    const { data, error } = await query.range(from, to);
    if (error) dbError(error);
    return (data ?? []) as unknown as BudgetRow[];
  });
  const history = rows.map(target);
  const budget =
    history.find(
      (version) =>
        version.effectiveMonth <= month &&
        (version.endMonth === null || version.endMonth >= month),
    ) ?? null;
  return { budget, history };
}
export const createBudgetTarget = createBudget;
export async function reviseBudgetTarget(
  ctx: BudgetContext,
  id: string,
  input: { amountCents: number; effectiveMonth: string },
) {
  return updateBudget(ctx, id, input);
}
export async function archiveBudgetTarget(
  ctx: BudgetContext,
  id: string,
  effectiveMonth: string,
) {
  return updateBudget(ctx, id, { archived: true, effectiveMonth });
}
export const inspectBudgetTarget = inspectBudgetHistory;
function zodFields(error: ZodError) {
  return error.flatten().fieldErrors;
}
export function toBudgetApiErrorResponse(error: unknown) {
  if (error instanceof SyntaxError)
    return NextResponse.json(
      {
        error: "Invalid request.",
        fields: { request: ["Request body must be valid JSON."] },
      },
      { status: 400 },
    );
  if (error instanceof ZodError)
    return NextResponse.json(
      { error: "Invalid request.", fields: zodFields(error) },
      { status: 400 },
    );
  if (error instanceof CategoryServiceError)
    return NextResponse.json(
      {
        error:
          error.status === 401 ? "Authentication required." : error.message,
      },
      { status: error.status },
    );
  if (error instanceof BudgetServiceError)
    return NextResponse.json(
      {
        error: error.message,
        ...(error.fields ? { fields: error.fields } : {}),
      },
      { status: error.status },
    );
  return NextResponse.json({ error: "Budgets unavailable." }, { status: 500 });
}
