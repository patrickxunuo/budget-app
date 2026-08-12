import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { collectAllPages } from "@/lib/supabase/pagination";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeMerchantMatcher, normalizeMerchantName } from "./domain";
import type { Category, MerchantRule, TransactionCategoryView } from "./types";
export type CategoryContext = {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  userId: string;
  workspaceId: string;
};
export type TransactionFilters = {
  scope?: "family" | "personal";
  from?: string;
  to?: string;
  categoryId?: string;
};
export class CategoryServiceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
type DatabaseError = { code?: string } | null;
type CategoryRow = {
  id: string;
  name: string;
  color: string | null;
  scope: "family" | "personal";
  owner_profile_id: string | null;
  system_key: string | null;
  archived_at: string | null;
  in_use?: boolean;
};
type RuleRow = {
  id: string;
  category_id: string;
  scope: "family" | "personal";
  owner_profile_id: string | null;
  match_type: "merchant_id" | "normalized_name";
  merchant_match?: string;
  match_value?: string;
  enabled: boolean;
  archived_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};
type TransactionRow = {
  id: string;
  merchant_name: string | null;
  name: string;
  amount: number | string;
  transaction_date: string;
  pending: boolean;
  provider_payload: unknown;
  accounts:
    | { scope: "family" | "personal"; owner_profile_id: string | null }
    | { scope: "family" | "personal"; owner_profile_id: string | null }[];
  transaction_metadata:
    TransactionMetadataRow | TransactionMetadataRow[] | null;
};
type TransactionMetadataRow = {
  merchant_rule_id: string | null;
  kind_override: "income" | "spending" | "transfer" | "refund" | null;
  excluded: boolean;
  updated_by: string;
  updated_at: string;
  categories:
    | Pick<CategoryRow, "id" | "name" | "color">
    | Pick<CategoryRow, "id" | "name" | "color">[]
    | null;
};
type ProviderPayload = {
  stableMerchantId?: unknown;
  personalFinanceCategory?: { primary?: unknown; detailed?: unknown };
};

const rowCategory = (r: CategoryRow): Category => ({
  id: r.id,
  name: r.name,
  color: r.color,
  scope: r.scope,
  ownerProfileId: r.owner_profile_id,
  systemKey: r.system_key,
  archivedAt: r.archived_at,
  inUse: Boolean(r.in_use),
});
const rowRule = (r: RuleRow): MerchantRule => ({
  id: r.id,
  categoryId: r.category_id,
  scope: r.scope,
  ownerProfileId: r.owner_profile_id,
  matchType: r.match_type,
  matchValue: r.match_value ?? r.merchant_match ?? "",
  enabled: r.enabled,
  archivedAt: r.archived_at,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
function dbError(
  error: DatabaseError,
  fallback = "The request could not be completed.",
): never {
  if (error?.code === "23505")
    throw new CategoryServiceError(
      409,
      "An active record with these details already exists.",
    );
  if (error?.code === "42501")
    throw new CategoryServiceError(403, "This record is not available.");
  throw new CategoryServiceError(400, fallback);
}
export async function getApiContext(): Promise<CategoryContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new CategoryServiceError(401, "Authentication required.");
  const { data, error } = await supabase
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("profile_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (error || !data)
    throw new CategoryServiceError(
      403,
      "An active workspace membership is required.",
    );
  return {
    supabase,
    userId: user.id,
    workspaceId: data.workspace_id as string,
  };
}
export function toApiErrorResponse(error: unknown) {
  if (error instanceof SyntaxError)
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  if (error instanceof ZodError)
    return NextResponse.json(
      { error: "Invalid request.", fields: error.flatten().fieldErrors },
      { status: 400 },
    );
  const e =
    error instanceof CategoryServiceError
      ? error
      : new CategoryServiceError(500, "The request could not be completed.");
  return NextResponse.json({ error: e.message }, { status: e.status });
}
export async function listCategoriesAndRules(ctx: CategoryContext) {
  const [{ data: categories, error: ce }, { data: rules, error: re }] =
    await Promise.all([
      ctx.supabase
        .from("category_views")
        .select("*")
        .eq("workspace_id", ctx.workspaceId)
        .order("scope")
        .order("name"),
      ctx.supabase
        .from("merchant_rules")
        .select("*")
        .eq("workspace_id", ctx.workspaceId)
        .order("created_at", { ascending: false }),
    ]);
  if (ce || re) dbError(ce || re);
  return {
    categories: (categories ?? []).map(rowCategory),
    rules: (rules ?? []).map(rowRule),
  };
}
export async function createCategory(
  ctx: CategoryContext,
  input: { name: string; color: string; scope: "family" | "personal" },
) {
  const { data, error } = await ctx.supabase
    .from("categories")
    .insert({
      workspace_id: ctx.workspaceId,
      created_by: ctx.userId,
      name: input.name,
      color: input.color,
      scope: input.scope,
      owner_profile_id: input.scope === "personal" ? ctx.userId : null,
    })
    .select("*")
    .single();
  if (error) dbError(error);
  return rowCategory({ ...data, in_use: false });
}
export async function updateCategory(
  ctx: CategoryContext,
  id: string,
  input: { name?: string; color?: string; archived?: boolean },
) {
  const update: { name?: string; color?: string; archived_at?: string | null } =
    {};
  if (input.name !== undefined) update.name = input.name;
  if (input.color !== undefined) update.color = input.color;
  if (input.archived !== undefined)
    update.archived_at = input.archived ? new Date().toISOString() : null;
  const { data, error } = await ctx.supabase
    .from("categories")
    .update(update)
    .eq("id", id)
    .eq("workspace_id", ctx.workspaceId)
    .select("*")
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw new CategoryServiceError(404, "Category not found.");
  return rowCategory({ ...data, in_use: false });
}
function asProviderPayload(payload: unknown): ProviderPayload {
  return payload && typeof payload === "object"
    ? (payload as ProviderPayload)
    : {};
}
function pfc(payload: unknown) {
  const x = asProviderPayload(payload).personalFinanceCategory;
  return x && typeof x.primary === "string" && typeof x.detailed === "string"
    ? { primary: x.primary, detailed: x.detailed }
    : null;
}
export async function listTransactions(
  ctx: CategoryContext,
  limit?: number,
  transactionId?: string,
  filters: TransactionFilters = {},
) {
  const rows = await collectAllPages<TransactionRow>(async (from, to) => {
    let query = ctx.supabase
      .from("transactions")
      .select(
        "id,merchant_name,name,amount,transaction_date,pending,provider_payload,accounts!inner(scope,owner_profile_id),transaction_metadata(category_id,merchant_rule_id,kind_override,excluded,updated_by,updated_at,categories(id,name,color))",
      )
      .eq("workspace_id", ctx.workspaceId)
      .is("removed_at", null)
      .order("transaction_date", { ascending: false })
      .order("id", { ascending: true });
    if (transactionId) query = query.eq("id", transactionId);
    if (filters.scope) query = query.eq("accounts.scope", filters.scope);
    if (filters.from) query = query.gte("transaction_date", filters.from);
    if (filters.to) query = query.lte("transaction_date", filters.to);
    const { data, error } = await query.range(from, to);
    if (error) dbError(error);
    return (data ?? []) as unknown as TransactionRow[];
  });
  const { categories } = await listCategoriesAndRules(ctx);
  const bySystem = new Map(categories.map((c) => [c.systemKey, c]));
  const transactions = rows.map((r) => {
    const account = Array.isArray(r.accounts) ? r.accounts[0] : r.accounts;
    if (!account)
      throw new CategoryServiceError(
        500,
        "Transaction privacy context is unavailable.",
      );
    const md = Array.isArray(r.transaction_metadata)
      ? r.transaction_metadata[0]
      : r.transaction_metadata;
    const cat = Array.isArray(md?.categories)
      ? md.categories[0]
      : md?.categories;
    const original = pfc(r.provider_payload);
    const fallback = original
      ? (bySystem.get(original.detailed) ?? bySystem.get(original.primary))
      : undefined;
    const chosen = cat ?? fallback;
    return {
      id: r.id,
      scope: account.scope,
      ownerProfileId: account.owner_profile_id,
      merchantName: r.merchant_name,
      name: r.name,
      amount: Number(r.amount),
      transactionDate: r.transaction_date,
      pending: r.pending,
      kindOverride: md?.kind_override ?? null,
      excluded: md?.excluded ?? false,
      originalPlaidCategory: original,
      effectiveCategory: chosen
        ? {
            id: chosen.id,
            name: chosen.name,
            color: chosen.color,
            source: cat ? (md?.merchant_rule_id ? "rule" : "manual") : "plaid",
            updatedBy: cat ? (md?.updated_by ?? null) : null,
            updatedAt: cat ? (md?.updated_at ?? null) : null,
          }
        : null,
      stableMerchantId:
        typeof asProviderPayload(r.provider_payload).stableMerchantId ===
        "string"
          ? (asProviderPayload(r.provider_payload).stableMerchantId as string)
          : null,
      normalizedMerchant:
        normalizeMerchantName(r.merchant_name) || normalizeMerchantName(r.name),
    } satisfies TransactionCategoryView;
  });
  const filtered = filters.categoryId
    ? transactions.filter(
        (transaction) =>
          transaction.effectiveCategory?.id === filters.categoryId,
      )
    : transactions;
  return limit === undefined ? filtered : filtered.slice(0, limit);
}
export async function setManualCategory(
  ctx: CategoryContext,
  transactionId: string,
  categoryId: string,
) {
  const { data, error } = await ctx.supabase.rpc(
    "set_manual_transaction_category",
    { p_transaction_id: transactionId, p_category_id: categoryId },
  );
  if (error) dbError(error);
  if (!data)
    throw new CategoryServiceError(404, "Transaction or category not found.");
  const rows = await listTransactions(ctx, 1, transactionId);
  return (
    rows.find((r) => r.id === transactionId) ??
    (() => {
      throw new CategoryServiceError(404, "Transaction not found.");
    })()
  );
}
async function matcherFor(ctx: CategoryContext, transactionId: string) {
  const { data, error } = await ctx.supabase
    .from("transactions")
    .select("merchant_name,name,provider_payload")
    .eq("id", transactionId)
    .eq("workspace_id", ctx.workspaceId)
    .is("removed_at", null)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw new CategoryServiceError(404, "Transaction not found.");
  const matcher = normalizeMerchantMatcher({
    stableMerchantId:
      typeof asProviderPayload(data.provider_payload).stableMerchantId ===
      "string"
        ? (asProviderPayload(data.provider_payload).stableMerchantId as string)
        : null,
    merchantName: data.merchant_name,
    name: data.name,
  });
  if (!matcher)
    throw new CategoryServiceError(
      400,
      "This merchant does not have a safe reusable identity.",
    );
  return matcher;
}
export async function previewMerchantRule(
  ctx: CategoryContext,
  input: {
    transactionId: string;
    categoryId: string;
    scope: "family" | "personal";
  },
) {
  const matcher = await matcherFor(ctx, input.transactionId);
  const { data, error } = await ctx.supabase.rpc("preview_merchant_rule", {
    p_transaction_id: input.transactionId,
    p_category_id: input.categoryId,
    p_scope: input.scope,
    p_match_type: matcher.matchType,
    p_match_value: matcher.matchValue,
  });
  if (error) dbError(error);
  if (data === null)
    throw new CategoryServiceError(404, "Transaction or category not found.");
  return { matcher, matchCount: Number(data) };
}
export async function createMerchantRule(
  ctx: CategoryContext,
  input: {
    transactionId: string;
    categoryId: string;
    scope: "family" | "personal";
    applyExisting: boolean;
  },
) {
  const matcher = await matcherFor(ctx, input.transactionId);
  const { data, error } = await ctx.supabase.rpc("create_merchant_rule", {
    p_transaction_id: input.transactionId,
    p_category_id: input.categoryId,
    p_scope: input.scope,
    p_match_type: matcher.matchType,
    p_match_value: matcher.matchValue,
    p_apply_existing: input.applyExisting,
  });
  if (error) dbError(error);
  const result = data as unknown as {
    rule: RuleRow;
    updatedCount: number | string;
  } | null;
  if (!result)
    throw new CategoryServiceError(404, "Transaction or category not found.");
  return {
    rule: rowRule(result.rule),
    updatedCount: Number(result.updatedCount),
  };
}
export async function updateMerchantRule(
  ctx: CategoryContext,
  id: string,
  input: { categoryId?: string; enabled?: boolean; archived?: boolean },
) {
  const { data, error } = await ctx.supabase.rpc("update_merchant_rule", {
    p_rule_id: id,
    p_category_id: input.categoryId ?? null,
    p_enabled: input.enabled ?? null,
    p_archived: input.archived ?? null,
  });
  if (error) {
    if (error.code === "23514")
      throw new CategoryServiceError(
        409,
        "A rule already applied to transactions cannot change category; archive it and create a replacement rule.",
      );
    dbError(error);
  }
  if (!data) throw new CategoryServiceError(404, "Rule not found.");
  return rowRule(data as unknown as RuleRow);
}
