"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePendingAction } from "@/hooks/use-pending-action";
import { moveReference } from "@/lib/dashboard/domain";
import type { DashboardReadModel } from "@/lib/dashboard/types";
import {
  describeActiveFilters,
  SEARCH_MAX_LENGTH,
  toExplorerSearchParams,
  toReadModelQuery,
  type ExplorerFilters,
  type ExplorerInclusion,
  type ExplorerPeriod,
  type ExplorerScope,
  type ExplorerStatus,
} from "@/lib/transactions/explorer-filters";

export type TransactionExplorerProps = {
  initialModel: DashboardReadModel;
  initialFilters: ExplorerFilters;
};

const DISPLAY_LIMIT = 50;
const SEARCH_DEBOUNCE_MS = 120;
const REFRESHING_REASON = "Refreshing the filtered view.";
const EMPTY_REASON = "No transactions match the current filters.";

const PERIODS: ReadonlyArray<{ value: ExplorerPeriod; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "custom", label: "Custom" },
];
const STATUS_OPTIONS: ReadonlyArray<{ value: ExplorerStatus; label: string }> =
  [
    { value: "all", label: "All statuses" },
    { value: "pending", label: "Pending" },
    { value: "posted", label: "Posted" },
  ];
const INCLUSION_OPTIONS: ReadonlyArray<{
  value: ExplorerInclusion;
  label: string;
}> = [
  { value: "default", label: "Included by default" },
  { value: "included", label: "Included" },
  { value: "excluded", label: "Excluded" },
  { value: "transfers", label: "Transfers" },
  { value: "all", label: "All lines" },
];

const money = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
});
const day = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const cad = (cents: number) => money.format(cents / 100);
const formatDay = (date: string) => day.format(new Date(`${date}T00:00:00Z`));
const formatRange = (startDate: string, endDate: string) =>
  startDate === endDate
    ? formatDay(startDate)
    : `${formatDay(startDate)} to ${formatDay(endDate)}`;

const pill =
  "focus-visible:outline-focus inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2";
// The 16px type is deliberate: anything smaller makes iOS zoom on focus, which
// is how a 390px layout acquires horizontal overflow.
const field =
  "border-line bg-surface focus-visible:outline-focus min-h-11 w-full min-w-0 rounded-xl border px-3 font-sans text-base tracking-normal normal-case focus-visible:outline-2 focus-visible:outline-offset-2";
const fieldLabel =
  "font-utility text-muted grid gap-1.5 text-[.62rem] font-semibold tracking-[.14em] uppercase";

export function TransactionExplorer({
  initialModel,
  initialFilters,
}: TransactionExplorerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [model, setModel] = useState(initialModel);
  const [filters, setFilters] = useState(initialFilters);
  const [searchInput, setSearchInput] = useState(initialFilters.search);
  const [draftFrom, setDraftFrom] = useState(
    initialFilters.from || initialModel.range.startDate,
  );
  const [draftTo, setDraftTo] = useState(
    initialFilters.to || initialModel.range.endDate,
  );
  const { pending: loading, run } = usePendingAction({ strategy: "latest" });
  const [error, setError] = useState("");
  // The export always describes the query that produced the rows on screen, so
  // it is snapshotted when a response lands rather than read from live controls.
  const [exportQuery, setExportQuery] = useState(() =>
    new URLSearchParams(toReadModelQuery(initialFilters)).toString(),
  );
  // The filters the rows on screen were actually produced by. Distinct from
  // `filters`, which is the live control state: after a rejected refresh the
  // empty state must name the filters that produced the retained rows, not the
  // ones the member had just typed.
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);

  const readModelQuery = useMemo(
    () => new URLSearchParams(toReadModelQuery(filters)).toString(),
    [filters],
  );
  const explorerQuery = useMemo(
    () => toExplorerSearchParams(filters),
    [filters],
  );

  // Seeded with the view the server already answered, so first paint never
  // spends a request re-asking the same question — and a re-run of this effect
  // on a remount cannot turn that seed into one either.
  const appliedView = useRef(`${readModelQuery}|${explorerQuery}`);
  const requestId = useRef(0);
  const debounceMs = useRef(0);
  const displayedScope = useRef<ExplorerScope>(initialModel.scope);
  const customRangeTouched = useRef(false);
  const filtersRef = useRef(filters);

  // `filters` cannot go in the refresh effect's own dependency array: a change
  // that left both query strings identical would cancel an in-flight request
  // without starting a replacement, and the pending flag would never clear.
  //
  // What makes reading this ref from the response continuation safe is not the
  // declaration order — by then both effects have long since run — but that
  // every field of ExplorerFilters is encoded in `explorerQuery`. Any value
  // change therefore re-runs the refresh effect and supersedes the in-flight
  // request, so `settled()` being true implies the ref still holds the filters
  // that produced the response. Keep that invariant if you add a field.
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    const view = `${readModelQuery}|${explorerQuery}`;
    if (view === appliedView.current) return;
    appliedView.current = view;
    const id = ++requestId.current;
    // Cancelled by this effect's cleanup — on a filter change, and critically on
    // unmount. A scope selection unmounts this component (the page keys it), and
    // an in-flight fetch cannot be cancelled once its timer has fired: without
    // this flag a late response would `replaceState` the address bar back to the
    // scope the member just left, so the URL would name a different ledger than
    // the one on screen. The request-id guard alone cannot catch that, because
    // the ref it compares against belongs to the unmounted instance.
    let cancelled = false;
    const settled = () => !cancelled && id === requestId.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let releaseDelay: (() => void) | undefined;
    void run(async () => {
      setError("");
      if (debounceMs.current > 0) {
        await new Promise<void>((resolve) => {
          releaseDelay = resolve;
          timer = setTimeout(resolve, debounceMs.current);
        });
      }
      if (!settled()) return;
      try {
        const response = await fetch(
          `/api/dashboard?${readModelQuery}&limit=${DISPLAY_LIMIT}`,
          { headers: { accept: "application/json" } },
        );
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            typeof body.error === "string"
              ? body.error
              : "The filtered view could not be refreshed. Try again.",
          );
        // A slow earlier response must never overwrite a newer one.
        if (!settled()) return;
        displayedScope.current = body.scope;
        setModel(body);
        setExportQuery(readModelQuery);
        setAppliedFilters(filtersRef.current);
        if (!customRangeTouched.current) {
          setDraftFrom(body.range.startDate);
          setDraftTo(body.range.endDate);
        }
        // Sync, never navigate: the address bar reproduces the view on screen.
        window.history.replaceState(
          null,
          "",
          explorerQuery ? `/transactions?${explorerQuery}` : "/transactions",
        );
      } catch (reason) {
        if (!settled()) return;
        const message =
          reason instanceof Error
            ? reason.message
            : "The filtered view could not be refreshed.";
        setError(
          `${/try again/i.test(message) ? message : `${message} Try again.`} Showing retained ${displayedScope.current} data.`,
        );
      }
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      releaseDelay?.();
    };
  }, [readModelQuery, explorerQuery, run]);

  function update(patch: Partial<ExplorerFilters>, debounce = false) {
    debounceMs.current = debounce ? SEARCH_DEBOUNCE_MS : 0;
    setFilters((current) => ({ ...current, ...patch }));
  }

  function chooseScope(scope: ExplorerScope) {
    if (scope === filters.scope) return;
    // Account and category options are scope-specific, so they cannot survive
    // the move. Scope is a navigation: the server-rendered registers below have
    // to re-render in the new scope too.
    const next = toExplorerSearchParams({
      ...filters,
      scope,
      accountId: "",
      categoryId: "",
    });
    startTransition(() => {
      router.push(`/transactions?${next}`);
    });
  }

  function choosePeriod(period: ExplorerPeriod) {
    if (period === filters.period) return;
    if (period !== "custom") {
      // Leaving custom drops the drafts too, so returning to it later cannot
      // silently apply dates that were typed but never applied.
      customRangeTouched.current = false;
      setDraftFrom(model.range.startDate);
      setDraftTo(model.range.endDate);
      update({ period, from: "", to: "" });
      return;
    }
    const from = draftFrom || model.range.startDate;
    const to = draftTo || model.range.endDate;
    const ordered = from <= to ? { from, to } : { from: to, to: from };
    update({
      period,
      from: ordered.from,
      to: ordered.to,
      reference: ordered.to,
    });
  }

  function stepPeriod(direction: -1 | 1) {
    if (filters.period === "custom") {
      const from = filters.from || model.range.startDate;
      const to = filters.to || model.range.endDate;
      const nextFrom = moveReference(from, "custom", direction, from, to);
      const nextTo = moveReference(to, "custom", direction, from, to);
      customRangeTouched.current = false;
      update({ from: nextFrom, to: nextTo, reference: nextTo });
      return;
    }
    update({
      reference: moveReference(
        filters.reference,
        filters.period,
        direction,
        model.range.startDate,
        model.range.endDate,
      ),
    });
  }

  const customRangeReady =
    draftFrom !== "" && draftTo !== "" && draftFrom <= draftTo;

  function applyCustomRange() {
    if (!customRangeReady) return;
    customRangeTouched.current = false;
    update({
      period: "custom",
      from: draftFrom,
      to: draftTo,
      reference: draftTo,
    });
  }

  function changeSearch(value: string) {
    setSearchInput(value);
    update({ search: value.trim().slice(0, SEARCH_MAX_LENGTH).trim() }, true);
  }

  const busy = loading || isPending;
  const rows = model.transactions;
  const unknownAccount =
    filters.accountId !== "" &&
    !model.filterOptions.accounts.some(
      (account) => account.id === filters.accountId,
    );
  const unknownCategory =
    filters.categoryId !== "" &&
    !model.filterOptions.categories.some(
      (category) => category.id === filters.categoryId,
    );
  // Described from the filters the rows were produced by, not from the live
  // controls: after a rejected refresh those two disagree, and naming filters
  // that were never applied would misreport why the set is empty.
  const activeFilters = describeActiveFilters(
    appliedFilters,
    model.filterOptions,
  );
  const exportAvailable = !busy && rows.length > 0;
  const exportReason = busy
    ? REFRESHING_REASON
    : rows.length === 0
      ? EMPTY_REASON
      : "";
  const rangeLabel = formatRange(model.range.startDate, model.range.endDate);

  return (
    <section
      data-testid="transactions-explorer"
      aria-labelledby="transactions-explorer-title"
      className="mb-14 grid min-w-0 gap-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="font-utility text-brand text-[.62rem] font-semibold tracking-[.16em] uppercase">
            Exploration · {model.scope} ledger
          </p>
          <h2
            id="transactions-explorer-title"
            className="font-display mt-2 text-3xl leading-none font-semibold tracking-[-.035em]"
          >
            Narrow it, then take it with you.
          </h2>
        </div>
        <div
          role="group"
          aria-label="Privacy scope"
          className="border-line bg-panel flex rounded-full border p-1"
        >
          {(["family", "personal"] as const).map((option) => (
            <button
              key={option}
              type="button"
              data-testid={`transactions-scope-${option}`}
              aria-pressed={filters.scope === option}
              onClick={() => chooseScope(option)}
              className={`${pill} capitalize ${
                filters.scope === option
                  ? "bg-brand text-on-accent"
                  : "text-muted hover:text-ink"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="border-line bg-surface grid min-w-0 gap-4 rounded-2xl border p-4 sm:p-5">
        <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-center">
          <div
            role="group"
            aria-label="Accounting period"
            className="flex flex-wrap gap-2"
          >
            {PERIODS.map((period) => (
              <button
                key={period.value}
                type="button"
                data-testid={`transactions-period-${period.value}`}
                aria-pressed={filters.period === period.value}
                aria-label={
                  period.value === "week"
                    ? "Week, Monday through Sunday"
                    : period.value === "custom"
                      ? "Custom range"
                      : period.label
                }
                onClick={() => choosePeriod(period.value)}
                className={`${pill} border ${
                  filters.period === period.value
                    ? "border-brand bg-brand text-on-accent"
                    : "border-line text-muted hover:text-ink"
                }`}
              >
                {period.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2 sm:ml-auto">
            <button
              type="button"
              data-testid="transactions-previous-period"
              aria-label="Previous period"
              onClick={() => stepPeriod(-1)}
              className={`${pill} border-line text-ink hover:bg-panel flex-1 border`}
            >
              Previous
            </button>
            <button
              type="button"
              data-testid="transactions-next-period"
              aria-label="Next period"
              onClick={() => stepPeriod(1)}
              className={`${pill} border-line text-ink hover:bg-panel flex-1 border`}
            >
              Next
            </button>
          </div>
        </div>

        {filters.period === "custom" && (
          <div className="border-line bg-panel grid gap-3 rounded-xl border p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className={fieldLabel}>
              From
              <input
                data-testid="transactions-custom-from"
                type="date"
                value={draftFrom}
                onChange={(event) => {
                  customRangeTouched.current = true;
                  setDraftFrom(event.target.value);
                }}
                className={field}
              />
            </label>
            <label className={fieldLabel}>
              To
              <input
                data-testid="transactions-custom-to"
                type="date"
                value={draftTo}
                onChange={(event) => {
                  customRangeTouched.current = true;
                  setDraftTo(event.target.value);
                }}
                className={field}
              />
            </label>
            <button
              type="button"
              data-testid="transactions-custom-apply"
              onClick={applyCustomRange}
              disabled={!customRangeReady}
              className={`${pill} bg-brand text-on-accent disabled:cursor-not-allowed disabled:opacity-50`}
            >
              Apply range
            </button>
            <p className="text-muted col-span-full text-xs leading-5">
              {customRangeReady
                ? "Previous and Next then step by whole range lengths."
                : "Choose a start and an end date; the end cannot precede the start."}
            </p>
          </div>
        )}

        <div className="border-line flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t pt-4">
          <p
            data-testid="transactions-range-label"
            className="font-display text-xl font-semibold tracking-[-.02em]"
          >
            {rangeLabel}
          </p>
          <p className="font-utility text-muted text-[.62rem] tracking-[.14em] uppercase">
            {model.timeZone} · {rows.length}
            {rows.length === DISPLAY_LIMIT ? " newest" : ""} line
            {rows.length === 1 ? "" : "s"} shown
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <label className={fieldLabel}>
            Search
            <input
              data-testid="transactions-search"
              type="search"
              value={searchInput}
              maxLength={SEARCH_MAX_LENGTH}
              placeholder="Merchant, description, account"
              onChange={(event) => changeSearch(event.target.value)}
              className={field}
            />
          </label>
          <label className={fieldLabel}>
            Account
            <select
              data-testid="transactions-account-filter"
              value={filters.accountId}
              onChange={(event) => update({ accountId: event.target.value })}
              className={field}
            >
              <option value="">All accounts</option>
              {model.filterOptions.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
              {/* A hand-typed id, or one belonging to the other scope, is still
                  filtering the request. Without a matching option the control
                  would read "All accounts" while the set stayed narrowed. */}
              {unknownAccount && (
                <option value={filters.accountId}>Unavailable account</option>
              )}
            </select>
          </label>
          <label className={fieldLabel}>
            Category
            <select
              data-testid="transactions-category-filter"
              value={filters.categoryId}
              onChange={(event) => update({ categoryId: event.target.value })}
              className={field}
            >
              <option value="">All categories</option>
              {model.filterOptions.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
              {unknownCategory && (
                <option value={filters.categoryId}>Unavailable category</option>
              )}
            </select>
          </label>
          <label className={fieldLabel}>
            Status
            <select
              data-testid="transactions-status-filter"
              value={filters.status}
              onChange={(event) =>
                update({ status: event.target.value as ExplorerStatus })
              }
              className={field}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldLabel}>
            Inclusion
            <select
              data-testid="transactions-inclusion-filter"
              value={filters.inclusion}
              onChange={(event) =>
                update({ inclusion: event.target.value as ExplorerInclusion })
              }
              className={field}
            >
              {INCLUSION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="border-line flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="w-full min-w-0 sm:w-auto sm:flex-1">
            <p className="font-utility text-muted text-[.62rem] font-semibold tracking-[.14em] uppercase">
              Portable ledger
            </p>
            <p className="text-muted mt-1 text-sm leading-5">
              Downloads exactly the {model.scope} view on screen as a safe UTF-8
              CSV.
            </p>
            <p
              id="transactions-export-reason"
              data-testid="transactions-export-reason"
              className={exportReason ? "text-mineral mt-1 text-xs" : "sr-only"}
            >
              {exportReason}
            </p>
          </div>
          <a
            data-testid="transactions-export-csv"
            href={
              exportAvailable
                ? `/api/transactions/export?${exportQuery}`
                : undefined
            }
            download
            role={exportAvailable ? undefined : "link"}
            tabIndex={0}
            aria-disabled={exportAvailable ? undefined : true}
            aria-busy={busy || undefined}
            aria-describedby="transactions-export-reason"
            onClick={(event) => {
              if (!exportAvailable) event.preventDefault();
            }}
            className={`${pill} border-2 ${
              exportAvailable
                ? "border-brand text-brand hover:bg-brand hover:text-on-accent transition-colors"
                : "border-line text-muted cursor-not-allowed opacity-60"
            }`}
          >
            Export CSV
          </a>
        </div>
      </div>

      <p
        data-testid="transactions-loading"
        role="status"
        aria-live="polite"
        className="font-utility text-mineral min-h-5 text-[.7rem] tracking-[.12em] uppercase"
      >
        {busy ? REFRESHING_REASON : ""}
      </p>

      <p
        data-testid="transactions-error"
        role="alert"
        className={
          error
            ? "border-alert bg-alert/5 text-alert rounded-xl border px-4 py-3 text-sm"
            : "sr-only"
        }
      >
        {error}
      </p>

      <div
        aria-label="Filtered totals"
        role="group"
        className="border-line bg-line grid gap-px overflow-hidden rounded-2xl border sm:grid-cols-2 xl:grid-cols-4"
      >
        {[
          {
            label: "Income",
            value: cad(model.summary.incomeCents),
            testId: "transactions-summary-income",
          },
          {
            label: "Spending after refunds",
            value: cad(model.summary.spendingCents),
            testId: "transactions-summary-spending",
          },
          {
            label: "Net flow",
            value: cad(model.summary.netFlowCents),
            testId: "transactions-summary-net",
          },
        ].map((tile) => (
          <article key={tile.testId} className="bg-surface px-5 py-4">
            <p className="font-utility text-muted text-[.62rem] font-semibold tracking-[.14em] uppercase">
              {tile.label}
            </p>
            <p
              data-testid={tile.testId}
              className="font-display text-ink mt-3 text-2xl font-semibold tabular-nums"
            >
              {tile.value}
            </p>
          </article>
        ))}
        <article className="bg-panel px-5 py-4">
          <p className="font-utility text-muted text-[.62rem] font-semibold tracking-[.14em] uppercase">
            Pending
          </p>
          <p
            data-testid="transactions-summary-pending"
            className="font-display text-ink mt-3 text-2xl font-semibold tabular-nums"
          >
            {cad(model.summary.pendingAmountCents)} ·{" "}
            {model.summary.pendingCount} pending
          </p>
        </article>
        <p className="bg-surface text-muted col-span-full px-5 py-3 text-xs leading-5">
          Totals cover the complete filtered set, not just the lines listed
          below.
        </p>
      </div>

      <div
        data-testid="transactions-result-list"
        aria-label="Filtered transactions"
        role="group"
        className="border-line bg-surface min-w-0 overflow-hidden rounded-2xl border"
      >
        {rows.map((row) => (
          <article
            key={row.id}
            data-testid={`transactions-result-${row.id}`}
            className="border-line grid gap-2 border-b p-5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
          >
            <div className="min-w-0">
              <h3 className="font-display text-lg leading-tight font-semibold break-words">
                {row.merchantOrDescription}
              </h3>
              <p className="text-muted mt-1 text-xs leading-5">
                {row.date} · {row.source} · {row.scope} privacy ·{" "}
                {row.pending ? "Pending" : "Posted"} · {row.kind}
                {row.excluded ? " · Excluded" : ""}
              </p>
              <p className="text-muted text-xs leading-5">
                {row.accountName ?? "Off-bank manual entry"} ·{" "}
                {row.category?.name ?? "Uncategorized"}
              </p>
            </div>
            <strong
              className={`font-display text-xl font-semibold tabular-nums sm:text-right ${
                row.amountCents > 0 ? "text-brand" : "text-ink"
              }`}
            >
              {cad(row.amountCents)}
            </strong>
          </article>
        ))}
        {rows.length === 0 && (
          <div
            data-testid="transactions-empty-state"
            className="bg-panel px-6 py-12 text-center"
          >
            <p className="font-display text-2xl font-semibold">
              No matching transactions.
            </p>
            {activeFilters.length > 0 ? (
              <>
                <p className="text-muted mx-auto mt-2 max-w-md text-sm leading-6">
                  Nothing in {rangeLabel} survives every filter you have
                  applied:
                </p>
                <ul className="mt-3 flex flex-wrap justify-center gap-2">
                  {activeFilters.map((label) => (
                    <li
                      key={label}
                      className="border-line text-muted font-utility rounded-full border px-3 py-1 text-xs"
                    >
                      {label}
                    </li>
                  ))}
                </ul>
                <p className="text-muted mx-auto mt-4 max-w-md text-sm leading-6">
                  Widen one of them, or step to another period.
                </p>
              </>
            ) : (
              <p className="text-muted mx-auto mt-2 max-w-md text-sm leading-6">
                {rangeLabel} has no recorded {model.scope} activity. Step to
                another period, or record it in the Manual/Cash register below.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
