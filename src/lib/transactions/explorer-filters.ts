/**
 * Transactions exploration filters.
 *
 * This module is the single translation layer between the `/transactions` URL,
 * the strict `/api/dashboard` + `/api/transactions/export` query shapes, and the
 * explorer UI. It is imported by both a server component and a client
 * component, so it must stay free of `server-only`, of Node APIs, and of React.
 */

export type ExplorerScope = "family" | "personal";
export type ExplorerPeriod = "day" | "week" | "month" | "custom";
export type ExplorerStatus = "all" | "pending" | "posted";
export type ExplorerInclusion =
  "default" | "included" | "excluded" | "transfers" | "all";

export type ExplorerFilters = {
  scope: ExplorerScope;
  period: ExplorerPeriod;
  reference: string; // YYYY-MM-DD
  from: string; // YYYY-MM-DD; only meaningful when period === "custom"
  to: string; // YYYY-MM-DD; only meaningful when period === "custom"
  search: string; // "" when unset
  accountId: string; // "" when unset
  categoryId: string; // "" when unset
  status: ExplorerStatus;
  inclusion: ExplorerInclusion;
};

const SCOPES: readonly ExplorerScope[] = ["family", "personal"];
const PERIODS: readonly ExplorerPeriod[] = ["day", "week", "month", "custom"];
const STATUSES: readonly ExplorerStatus[] = ["all", "pending", "posted"];
const INCLUSIONS: readonly ExplorerInclusion[] = [
  "default",
  "included",
  "excluded",
  "transfers",
  "all",
];

/**
 * `dashboardQueryFields.search` caps the trimmed term at 100 characters.
 * Exported so the input's `maxLength` cannot drift away from the clamp this
 * module applies, or from the server's own `.max(100)`.
 */
export const SEARCH_MAX_LENGTH = 100;

/** Mirrors the `date` refinement in `@/lib/dashboard/validation`. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/**
 * Mirrors Zod's RFC 9562/4122 UUID regex, which is what both server schemas
 * apply to `accountId` and `categoryId`. Anything else is dropped rather than
 * forwarded into a request the server would reject.
 */
const UUID =
  /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;

function isUuid(value: string): boolean {
  return UUID.test(value);
}

function reader(
  raw: URLSearchParams | string | Record<string, string | string[] | undefined>,
): (key: string) => string {
  if (typeof raw === "string" || raw instanceof URLSearchParams) {
    const params = typeof raw === "string" ? new URLSearchParams(raw) : raw;
    return (key) => params.get(key) ?? "";
  }
  return (key) => {
    const value = raw[key];
    if (Array.isArray(value)) return value[0] ?? "";
    return typeof value === "string" ? value : "";
  };
}

function oneOf<T extends string>(
  allowed: readonly T[],
  value: string,
  fallback: T,
): T {
  return (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Untrusted URL input in, always-valid filters out. Never throws.
 *
 * `raw` also accepts the query string produced by `toExplorerSearchParams`, so
 * the documented round trip composes directly.
 */
export function parseExplorerFilters(
  raw: URLSearchParams | string | Record<string, string | string[] | undefined>,
  today: string,
): ExplorerFilters {
  const read = reader(raw);

  const scope = oneOf(SCOPES, read("scope"), "family");
  const requestedPeriod = oneOf(PERIODS, read("period"), "month");

  // A custom range must survive the server's `.strict()` schemas unchanged:
  // both bounds real calendar dates, in order. Anything else degrades to the
  // default month rather than producing a request that would be rejected.
  const rawFrom = read("from");
  const rawTo = read("to");
  const from = isCalendarDate(rawFrom) ? rawFrom : "";
  const to = isCalendarDate(rawTo) ? rawTo : "";
  const rangeUsable = from !== "" && to !== "" && from <= to;
  const period =
    requestedPeriod === "custom" && !rangeUsable ? "month" : requestedPeriod;

  const requestedReference = read("reference");
  const fallbackReference = isCalendarDate(requestedReference)
    ? requestedReference
    : today;
  // A custom range is anchored on its end date, so Previous/Next step by whole
  // range lengths — the convention FinancialDashboard already uses.
  const reference = period === "custom" ? to : fallbackReference;

  const search = read("search").trim().slice(0, SEARCH_MAX_LENGTH).trim();
  const accountId = isUuid(read("accountId")) ? read("accountId") : "";
  const categoryId = isUuid(read("categoryId")) ? read("categoryId") : "";

  return {
    scope,
    period,
    reference,
    from,
    to,
    search,
    accountId,
    categoryId,
    status: oneOf(STATUSES, read("status"), "all"),
    inclusion: oneOf(INCLUSIONS, read("inclusion"), "default"),
  };
}

/**
 * The strict `/api/dashboard` + `/api/transactions/export` query shape. `limit`
 * is not this module's concern; callers add it where the endpoint accepts one.
 */
export function toReadModelQuery(
  filters: ExplorerFilters,
): Record<string, string> {
  const query: Record<string, string> = {
    scope: filters.scope,
    period: filters.period,
    reference: filters.reference,
  };
  if (filters.period === "custom") {
    query.from = filters.from;
    query.to = filters.to;
  }
  if (filters.search) query.search = filters.search;
  if (filters.accountId) query.accountId = filters.accountId;
  if (filters.categoryId) query.categoryId = filters.categoryId;
  query.status = filters.status;
  query.inclusion = filters.inclusion;
  return query;
}

/**
 * The `/transactions?…` query string. Stable key order; defaults omitted.
 *
 * `reference` is always written: its default is the caller's `today`, which is
 * unknown here, and dropping it would make a shared link resolve to a different
 * period than the one that was shared.
 */
export function toExplorerSearchParams(filters: ExplorerFilters): string {
  const params = new URLSearchParams();
  if (filters.scope !== "family") params.set("scope", filters.scope);
  if (filters.period !== "month") params.set("period", filters.period);
  params.set("reference", filters.reference);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.search) params.set("search", filters.search);
  if (filters.accountId) params.set("accountId", filters.accountId);
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.inclusion !== "default")
    params.set("inclusion", filters.inclusion);
  return params.toString();
}

const STATUS_LABELS: Record<ExplorerStatus, string> = {
  all: "All statuses",
  pending: "Pending",
  posted: "Posted",
};

const INCLUSION_LABELS: Record<ExplorerInclusion, string> = {
  default: "Included by default",
  included: "Included",
  excluded: "Excluded",
  transfers: "Transfers",
  all: "All lines",
};

/**
 * An id with no matching option is still narrowing the request — a hand-typed
 * one, or one belonging to the scope the member just left. Naming it as
 * unavailable keeps the empty state truthful; echoing the raw UUID would just
 * put an implementation detail in front of the reader.
 */
function displayName(
  options: ReadonlyArray<{ id: string; name: string }>,
  id: string,
): string {
  return options.find((option) => option.id === id)?.name ?? "unavailable";
}

/**
 * Human-readable labels for every narrowing filter, for the empty state. Scope
 * and period choose which ledger and which days are on screen rather than
 * narrowing them, so neither is listed.
 */
export function describeActiveFilters(
  filters: ExplorerFilters,
  options: {
    accounts: ReadonlyArray<{ id: string; name: string }>;
    categories: ReadonlyArray<{ id: string; name: string }>;
  },
): string[] {
  const labels: string[] = [];
  if (filters.search) labels.push(`Search: "${filters.search}"`);
  if (filters.accountId)
    labels.push(`Account: ${displayName(options.accounts, filters.accountId)}`);
  if (filters.categoryId)
    labels.push(
      `Category: ${displayName(options.categories, filters.categoryId)}`,
    );
  if (filters.status !== "all")
    labels.push(`Status: ${STATUS_LABELS[filters.status]}`);
  if (filters.inclusion !== "default")
    labels.push(`Inclusion: ${INCLUSION_LABELS[filters.inclusion]}`);
  return labels;
}
