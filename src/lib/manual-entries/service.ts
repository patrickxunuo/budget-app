import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiAuthError, requirePlaidApiActor } from "@/lib/auth/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { collectAllPages } from "@/lib/supabase/pagination";
import type {
  ManualEntry,
  ManualEntryFilters,
  ManualEntryInput,
  ManualEntryUpdate,
} from "./types";
import { manualEntryInputSchema } from "./validation";

export type ManualEntryContext = {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  userId: string;
  workspaceId: string;
};

export class ManualEntryServiceError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

type ManualEntryRow = {
  id: string;
  scope: "family" | "personal";
  owner_profile_id: string | null;
  kind: "income" | "spending" | "refund";
  amount: string | number;
  currency_code: string;
  entry_date: string;
  description: string;
  category_id: string;
  notes: string | null;
  created_by: string;
  last_edited_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  categories?: { name?: string } | { name?: string }[] | null;
};

type DatabaseError = { code?: string; message?: string };

function categoryName(row: ManualEntryRow) {
  const category = Array.isArray(row.categories)
    ? row.categories[0]
    : row.categories;
  return category?.name;
}
function toEntry(row: ManualEntryRow): ManualEntry {
  const raw =
    typeof row.amount === "number" ? row.amount.toFixed(2) : row.amount;
  return {
    id: row.id,
    source: "manual",
    scope: row.scope,
    ownerProfileId: row.owner_profile_id,
    kind: row.kind,
    amount: raw,
    currencyCode: "CAD",
    entryDate: row.entry_date,
    description: row.description,
    categoryId: row.category_id,
    categoryName: categoryName(row),
    notes: row.notes,
    createdBy: row.created_by,
    lastEditedBy: row.last_edited_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
  };
}
function mutationError(error: DatabaseError | null): never {
  if (error?.code === "23503")
    throw new ManualEntryServiceError(
      400,
      "invalid_category",
      "Choose an active category in the same privacy scope.",
      { categoryId: "Category is not available for this entry." },
    );
  if (error?.code === "22023")
    throw new ManualEntryServiceError(
      400,
      "confirmation_required",
      "Confirm before deleting a Family entry.",
      { confirmed: "Confirmation is required for Family entries." },
    );
  if (error?.code === "23514" || error?.code === "22003")
    throw new ManualEntryServiceError(
      400,
      "invalid_entry",
      "The entry violates a ledger rule.",
    );
  if (error?.code === "42501")
    throw new ManualEntryServiceError(
      403,
      "forbidden",
      "An active family membership is required.",
    );
  throw new ManualEntryServiceError(
    400,
    "database_error",
    "The manual entry could not be saved.",
  );
}

export async function getManualEntryContext(): Promise<ManualEntryContext> {
  const actor = await requirePlaidApiActor();
  return {
    supabase: await createSupabaseServerClient(),
    userId: actor.userId,
    workspaceId: actor.workspaceId,
  };
}

export async function listManualEntries(
  ctx: ManualEntryContext,
  filters: ManualEntryFilters = {},
): Promise<ManualEntry[]> {
  const rows = await collectAllPages<ManualEntryRow>(async (from, to) => {
    let query = ctx.supabase
      .from("manual_entries")
      .select(
        "id,scope,owner_profile_id,kind,amount,currency_code,entry_date,description,category_id,notes,created_by,last_edited_by,created_at,updated_at,deleted_at,deleted_by,categories(name)",
      )
      .eq("workspace_id", ctx.workspaceId)
      .is("deleted_at", null)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true });
    if (filters.scope) query = query.eq("scope", filters.scope);
    if (filters.from) query = query.gte("entry_date", filters.from);
    if (filters.to) query = query.lte("entry_date", filters.to);
    if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
    const { data, error } = await query.range(from, to);
    if (error) mutationError(error);
    return (data ?? []) as unknown as ManualEntryRow[];
  });
  return rows.map(toEntry);
}

export async function createManualEntry(
  ctx: ManualEntryContext,
  input: ManualEntryInput,
): Promise<ManualEntry> {
  const { data, error } = await ctx.supabase.rpc("create_manual_entry", {
    p_scope: input.scope,
    p_kind: input.kind,
    p_amount: input.amount,
    p_entry_date: input.entryDate,
    p_description: input.description,
    p_category_id: input.categoryId,
    p_notes: input.notes ?? null,
  });
  if (error) mutationError(error);
  if (!data) mutationError(null);
  return toEntry(data as unknown as ManualEntryRow);
}

async function visibleEntry(ctx: ManualEntryContext, id: string) {
  const { data } = await ctx.supabase
    .from("manual_entries")
    .select("id,scope,kind,amount,entry_date,description,category_id,notes")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  return data as {
    id: string;
    scope: "family" | "personal";
    kind: "income" | "spending" | "refund";
    amount: string | number;
    entry_date: string;
    description: string;
    category_id: string;
    notes: string | null;
  } | null;
}

export async function updateManualEntry(
  ctx: ManualEntryContext,
  id: string,
  changes: ManualEntryUpdate,
): Promise<ManualEntry> {
  const current = await visibleEntry(ctx, id);
  if (!current)
    throw new ManualEntryServiceError(
      404,
      "not_found",
      "Manual entry not found.",
    );
  const merged = manualEntryInputSchema.parse({
    scope: current.scope,
    kind: changes.kind ?? current.kind,
    amount: changes.amount ?? String(current.amount),
    entryDate: changes.entryDate ?? current.entry_date,
    description: changes.description ?? current.description,
    categoryId: changes.categoryId ?? current.category_id,
    notes: Object.prototype.hasOwnProperty.call(changes, "notes")
      ? changes.notes
      : current.notes,
  });
  const { data, error } = await ctx.supabase.rpc("update_manual_entry", {
    p_id: id,
    p_kind: merged.kind,
    p_amount: merged.amount,
    p_entry_date: merged.entryDate,
    p_description: merged.description,
    p_category_id: merged.categoryId,
    p_notes: merged.notes ?? null,
  });
  if (error) mutationError(error);
  if (!data)
    throw new ManualEntryServiceError(
      404,
      "not_found",
      "Manual entry not found.",
    );
  return toEntry(data as unknown as ManualEntryRow);
}

export async function deleteManualEntry(
  ctx: ManualEntryContext,
  id: string,
  confirmed: boolean,
): Promise<ManualEntry> {
  const { data, error } = await ctx.supabase.rpc("soft_delete_manual_entry", {
    p_id: id,
    p_confirmed: confirmed,
  });
  if (error) mutationError(error);
  if (!data)
    throw new ManualEntryServiceError(
      404,
      "not_found",
      "Manual entry not found.",
    );
  return toEntry(data as unknown as ManualEntryRow);
}

function csvCell(value: string | null | undefined) {
  const text = value ?? "";
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function manualEntriesToCsv(entries: readonly ManualEntry[]) {
  const header = [
    "date",
    "description",
    "source",
    "scope",
    "kind",
    "amount",
    "currency",
    "category",
    "notes",
    "created_by",
    "last_edited_by",
  ];
  const rows = entries.map((entry) =>
    [
      entry.entryDate,
      entry.description,
      entry.source,
      entry.scope,
      entry.kind,
      entry.amount,
      entry.currencyCode,
      entry.categoryName ?? entry.categoryId,
      entry.notes,
      entry.createdBy,
      entry.lastEditedBy,
    ]
      .map(csvCell)
      .join(","),
  );
  return `${[header.join(","), ...rows].join("\r\n")}\r\n`;
}

function zodFields(error: ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "request");
    fields[key] ??= issue.message;
  }
  return fields;
}
export function toManualEntryApiErrorResponse(error: unknown) {
  if (error instanceof SyntaxError)
    return NextResponse.json(
      {
        error: {
          code: "validation_error",
          message: "Request body must be valid JSON.",
          fields: { request: "Request body must be valid JSON." },
        },
      },
      { status: 400 },
    );
  if (error instanceof ZodError)
    return NextResponse.json(
      {
        error: {
          code: "validation_error",
          message: "Check the highlighted fields.",
          fields: zodFields(error),
        },
      },
      { status: 400 },
    );
  if (error instanceof ApiAuthError)
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  if (error instanceof ManualEntryServiceError)
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
        },
      },
      { status: error.status },
    );
  return NextResponse.json(
    {
      error: {
        code: "internal_error",
        message: "The manual ledger is temporarily unavailable.",
      },
    },
    { status: 500 },
  );
}
