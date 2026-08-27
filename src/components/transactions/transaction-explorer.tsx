"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { SearchableSelect, Select } from "@/components/select";
import {
  TransactionDetailSheet,
  type TransactionDetailSelection,
} from "@/components/transactions/transaction-detail-sheet";
import { TransactionFeed } from "@/components/transactions/transaction-feed";
import { TransactionFilterSheet } from "@/components/transactions/transaction-filter-sheet";
import { TransactionManagementMenu } from "@/components/transactions/transaction-management-navigation";
import { usePendingAction } from "@/hooks/use-pending-action";
import { moveReference } from "@/lib/dashboard/domain";
import type {
  DashboardReadModel,
  DashboardTransaction,
} from "@/lib/dashboard/types";
import { formatLocalDate } from "@/lib/transactions/accounting";
import {
  describeActiveFilters,
  parseExplorerFilters,
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
const MOBILE_INITIAL_LIMIT = 10;
const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";

function subscribeToDesktopViewport(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const media = window.matchMedia(DESKTOP_MEDIA_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getDesktopViewportSnapshot() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia(DESKTOP_MEDIA_QUERY).matches
  );
}

function getDesktopViewportServerSnapshot() {
  return false;
}
const REVEAL_COUNT = 10;
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
  const searchParams = useSearchParams();
  const urlQuery = searchParams.toString();
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
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [detailSelection, setDetailSelection] =
    useState<TransactionDetailSelection | null>(null);
  const isDesktopViewport = useSyncExternalStore(
    subscribeToDesktopViewport,
    getDesktopViewportSnapshot,
    getDesktopViewportServerSnapshot,
  );
  const responsiveInitialLimit = isDesktopViewport
    ? DISPLAY_LIMIT
    : MOBILE_INITIAL_LIMIT;
  const [revealedCount, setRevealedCount] = useState<number | null>(null);
  const visibleCount = revealedCount ?? responsiveInitialLimit;
  const [paginationLoading, setPaginationLoading] = useState(false);
  const [paginationError, setPaginationError] = useState("");
  const [paginationStatus, setPaginationStatus] = useState("");
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

  const continuationRequestId = useRef(0);
  const lastUrlQuery = useRef(urlQuery);

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
    if (urlQuery === lastUrlQuery.current) return;
    lastUrlQuery.current = urlQuery;
    // Re-entering the canonical route means "this month now", not the date
    // from whichever historical URL originally seeded this preserved surface.
    // This effect runs only on the client, so reading the clock cannot alter
    // server markup or create a hydration mismatch.
    const currentTorontoDate = formatLocalDate(new Date(), "America/Toronto");
    const urlFilters = parseExplorerFilters(
      new URLSearchParams(urlQuery),
      currentTorontoDate,
    );
    if (toExplorerSearchParams(urlFilters) === explorerQuery) return;

    continuationRequestId.current += 1;
    const reconciliation = window.setTimeout(() => {
      // URL changes are an external navigation event. Reconcile on its task so
      // rapid back/forward changes can cancel stale work before it mutates the
      // preserved client surface.
      if (lastUrlQuery.current !== urlQuery) return;
      setPaginationLoading(false);
      setPaginationError("");
      setPaginationStatus("");
      setRevealedCount(null);
      setSearchInput(urlFilters.search);
      customRangeTouched.current = false;
      setDraftFrom(urlFilters.from || initialModel.range.startDate);
      setDraftTo(urlFilters.to || initialModel.range.endDate);
      debounceMs.current = 0;
      setFilters(urlFilters);
    }, 0);
    return () => window.clearTimeout(reconciliation);
  }, [
    explorerQuery,
    initialModel.range.endDate,
    initialModel.range.startDate,
    urlQuery,
  ]);

  useEffect(() => {
    const view = `${readModelQuery}|${explorerQuery}`;
    if (view === appliedView.current) return;
    appliedView.current = view;
    continuationRequestId.current += 1;
    setPaginationLoading(false);
    setPaginationError("");
    setPaginationStatus("");
    setRevealedCount(null);
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
        const nextModel = body as DashboardReadModel;
        displayedScope.current = nextModel.scope;
        setModel(nextModel);
        setRevealedCount(null);
        setPaginationError("");
        setPaginationStatus("");
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
    continuationRequestId.current += 1;
    setPaginationLoading(false);
    setPaginationError("");
    setPaginationStatus("");
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

  async function revealMore() {
    if (readModelQuery !== exportQuery || busy || paginationLoading) return;
    setPaginationError("");
    if (visibleCount < model.transactions.length) {
      const nextVisibleCount = Math.min(
        visibleCount + REVEAL_COUNT,
        model.transactions.length,
      );
      setRevealedCount(nextVisibleCount);
      setPaginationStatus(
        `${nextVisibleCount} of ${model.totalTransactionCount ?? model.transactions.length} transactions visible.`,
      );
      return;
    }

    const cursor = model.nextCursor;
    if (!cursor || paginationLoading) return;
    const id = ++continuationRequestId.current;
    const view = appliedView.current;
    setPaginationLoading(true);
    setPaginationStatus("Loading 10 more transactions.");
    try {
      const query = new URLSearchParams(exportQuery);
      query.set("limit", String(DISPLAY_LIMIT));
      query.set("cursor", cursor);
      const response = await fetch(`/api/dashboard?${query}`, {
        headers: { accept: "application/json" },
      });
      const body = (await response.json()) as DashboardReadModel & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          typeof body.error === "string"
            ? body.error
            : "More transactions could not be loaded.",
        );
      }
      if (id !== continuationRequestId.current || view !== appliedView.current)
        return;

      const seen = new Set(
        model.transactions.map((row) => `${row.source}:${row.id}`),
      );
      const additions = body.transactions.filter(
        (row) => !seen.has(`${row.source}:${row.id}`),
      );
      const transactions = [...model.transactions, ...additions];
      const nextVisibleCount = Math.min(
        visibleCount + REVEAL_COUNT,
        transactions.length,
      );
      setModel({ ...body, transactions });
      setRevealedCount(nextVisibleCount);
      setPaginationStatus(
        additions.length > 0
          ? `${nextVisibleCount} of ${body.totalTransactionCount} transactions visible.`
          : "No additional transactions were available.",
      );
    } catch (reason) {
      if (id !== continuationRequestId.current || view !== appliedView.current)
        return;
      setPaginationStatus("");
      setPaginationError(
        reason instanceof Error
          ? reason.message
          : "More transactions could not be loaded.",
      );
    } finally {
      if (id === continuationRequestId.current) setPaginationLoading(false);
    }
  }

  const busy = loading || isPending;
  const loadedRows = model.transactions;
  const rows = loadedRows.slice(0, visibleCount);
  const totalTransactionCount =
    model.totalTransactionCount ?? loadedRows.length;
  const canShowMore =
    rows.length < totalTransactionCount &&
    (visibleCount < loadedRows.length || Boolean(model.nextCursor));
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
  const exportAvailable = !busy && totalTransactionCount > 0;
  const exportReason = busy
    ? REFRESHING_REASON
    : rows.length === 0
      ? EMPTY_REASON
      : "";
  const rangeLabel = formatRange(model.range.startDate, model.range.endDate);
  const appliedExplorerQuery = toExplorerSearchParams(appliedFilters);
  const returnTo = `/transactions?${appliedExplorerQuery}`;

  const filterChips: Array<{
    field: string;
    label: string;
    clear: Partial<ExplorerFilters>;
  }> = [];
  if (appliedFilters.accountId) {
    filterChips.push({
      field: "account",
      label:
        model.filterOptions.accounts.find(
          (account) => account.id === appliedFilters.accountId,
        )?.name ?? "Unavailable account",
      clear: { accountId: "" },
    });
  }
  if (appliedFilters.categoryId) {
    filterChips.push({
      field: "category",
      label:
        model.filterOptions.categories.find(
          (category) => category.id === appliedFilters.categoryId,
        )?.name ?? "Unavailable category",
      clear: { categoryId: "" },
    });
  }
  if (appliedFilters.status !== "all") {
    filterChips.push({
      field: "status",
      label: appliedFilters.status,
      clear: { status: "all" },
    });
  }
  if (appliedFilters.inclusion !== "default") {
    filterChips.push({
      field: "inclusion",
      label:
        INCLUSION_OPTIONS.find(
          (option) => option.value === appliedFilters.inclusion,
        )?.label ?? appliedFilters.inclusion,
      clear: { inclusion: "default" },
    });
  }
  if (
    appliedFilters.period === "custom" &&
    appliedFilters.from &&
    appliedFilters.to
  ) {
    filterChips.push({
      field: "dates",
      label: `${appliedFilters.from} to ${appliedFilters.to}`,
      clear: { period: "month", from: "", to: "" },
    });
  }

  const emptyState = (
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
            Nothing in {rangeLabel} survives every filter you have applied:
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
          {rangeLabel} has no recorded {model.scope} activity. Step to another
          period, or use Manage to record it in the Manual/Cash register.
        </p>
      )}
    </div>
  );

  function selectTransaction(
    row: DashboardTransaction,
    trigger: HTMLButtonElement,
  ) {
    setDetailSelection({ id: row.id, source: row.source, trigger });
  }

  return (
    <section
      data-testid="transactions-explorer"
      aria-labelledby="transactions-explorer-title"
      className="mb-14 grid min-w-0 gap-4 md:gap-5"
    >
      <header className="grid min-w-0 gap-3">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-utility text-brand text-[.62rem] font-semibold tracking-[.16em] uppercase">
              {model.scope} ledger
            </p>
            <h2 id="transactions-explorer-title" className="sr-only">
              Transaction activity
            </h2>
          </div>
          <div className="hidden md:block">
            <TransactionManagementMenu
              scope={appliedFilters.scope}
              returnTo={returnTo}
            />
          </div>
        </div>
        <p
          data-testid="transactions-range-label"
          className="font-display text-lg font-semibold tracking-[-.02em] md:text-xl"
        >
          {rangeLabel}
        </p>
        <p
          data-testid="transactions-visible-count"
          className="font-utility text-muted text-[.66rem] font-semibold tracking-[.12em] uppercase"
        >
          <span className="font-display text-ink text-lg tracking-normal tabular-nums">
            {rows.length}
          </span>{" "}
          of {totalTransactionCount} transactions visible
        </p>
      </header>

      <div
        role="group"
        aria-label="Privacy scope"
        className="border-line bg-panel grid grid-cols-2 rounded-full border p-1 md:ml-auto md:flex md:w-fit"
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

      <div
        aria-label="Filtered totals"
        role="group"
        className="border-line bg-line grid grid-cols-2 gap-px overflow-hidden rounded-2xl border xl:grid-cols-4"
      >
        {[
          {
            label: "Income",
            value: cad(model.summary.incomeCents),
            testId: "transactions-summary-income",
          },
          {
            label: "Spending",
            value: cad(model.summary.spendingCents),
            testId: "transactions-summary-spending",
          },
          {
            label: "Net flow",
            value: cad(model.summary.netFlowCents),
            testId: "transactions-summary-net",
          },
          {
            label: "Pending",
            value: `${cad(model.summary.pendingAmountCents)} · ${model.summary.pendingCount}`,
            testId: "transactions-summary-pending",
          },
        ].map((tile) => (
          <article
            key={tile.testId}
            className="bg-surface min-w-0 px-3 py-3 md:px-5 md:py-4"
          >
            <p className="font-utility text-muted truncate text-[.55rem] font-semibold tracking-[.12em] uppercase md:text-[.62rem]">
              {tile.label}
            </p>
            <p
              data-testid={tile.testId}
              className="font-display text-ink mt-1 truncate text-lg font-semibold tabular-nums md:mt-3 md:text-2xl"
            >
              {tile.value}
            </p>
          </article>
        ))}
        <p className="bg-surface text-muted col-span-2 px-4 py-2 text-[.68rem] leading-5 md:px-5 md:py-3 md:text-xs xl:col-span-4">
          Complete filtered totals, independent of the visible page.
        </p>
      </div>

      <div className="border-line bg-surface grid min-w-0 gap-4 rounded-2xl border p-4 md:p-5">
        <div className="grid min-w-0 gap-3 md:flex md:flex-wrap md:items-center">
          <div
            role="group"
            aria-label="Accounting period"
            className="grid min-w-0 grid-cols-4 gap-1.5 md:flex md:flex-wrap md:gap-2"
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
                className={`${pill} min-w-0 border px-2 md:px-4 ${
                  filters.period === period.value
                    ? "border-brand bg-brand text-on-accent"
                    : "border-line text-muted hover:text-ink"
                }`}
              >
                {period.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 md:ml-auto md:flex">
            <button
              type="button"
              data-testid="transactions-previous-period"
              aria-label="Previous period"
              onClick={() => stepPeriod(-1)}
              className={`${pill} border-line text-ink hover:bg-panel size-11 border !px-0 md:size-auto md:!px-3`}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className="size-4"
                fill="none"
              >
                <path
                  d="m12 5-5 5 5 5"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="hidden md:ml-2 md:inline">Previous</span>
            </button>
            <button
              type="button"
              data-testid="transactions-next-period"
              aria-label="Next period"
              onClick={() => stepPeriod(1)}
              className={`${pill} border-line text-ink hover:bg-panel size-11 border !px-0 md:size-auto md:!px-3`}
            >
              <span className="hidden md:mr-2 md:inline">Next</span>
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className="size-4"
                fill="none"
              >
                <path
                  d="m8 5 5 5-5 5"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>

        {filters.period === "custom" && !filterSheetOpen && (
          <div className="border-line bg-panel hidden gap-3 rounded-xl border p-3 md:grid md:grid-cols-[1fr_1fr_auto] md:items-end">
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
              className={`${pill} bg-brand text-on-accent disabled:opacity-50`}
            >
              Apply range
            </button>
          </div>
        )}

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 md:grid-cols-1">
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
          {!isDesktopViewport && (
            <div className="self-end">
              <TransactionFilterSheet
                filters={filters}
                accounts={model.filterOptions.accounts}
                categories={model.filterOptions.categories}
                unknownAccount={unknownAccount}
                unknownCategory={unknownCategory}
                draftFrom={draftFrom}
                draftTo={draftTo}
                customRangeReady={customRangeReady}
                onOpenChange={setFilterSheetOpen}
                onUpdate={(patch) => update(patch)}
                onDraftFrom={(value) => {
                  customRangeTouched.current = true;
                  setDraftFrom(value);
                }}
                onDraftTo={(value) => {
                  customRangeTouched.current = true;
                  setDraftTo(value);
                }}
                onApplyCustomRange={applyCustomRange}
              />
            </div>
          )}
        </div>

        {!filterSheetOpen && (
          <div className="hidden gap-3 md:grid md:grid-cols-2 xl:grid-cols-4">
            <label className={fieldLabel}>
              Account
              <Select
                data-testid="transactions-account-filter"
                value={filters.accountId}
                onValueChange={(accountId) => update({ accountId })}
                options={[
                  { value: "", label: "All accounts" },
                  ...model.filterOptions.accounts.map((account) => ({
                    value: account.id,
                    label: account.name,
                  })),
                  ...(unknownAccount
                    ? [
                        {
                          value: filters.accountId,
                          label: "Unavailable account",
                        },
                      ]
                    : []),
                ]}
                className={field}
              />
            </label>
            <label className={fieldLabel}>
              Category
              <SearchableSelect
                data-testid="transactions-category-filter"
                value={filters.categoryId}
                onValueChange={(categoryId) => update({ categoryId })}
                placeholder="All categories"
                searchPlaceholder="Search categories"
                emptyMessage="No categories match"
                options={[
                  { value: "", label: "All categories" },
                  ...model.filterOptions.categories.map((category) => ({
                    value: category.id,
                    label: category.name,
                  })),
                  ...(unknownCategory
                    ? [
                        {
                          value: filters.categoryId,
                          label: "Unavailable category",
                        },
                      ]
                    : []),
                ]}
                className={field}
              />
            </label>
            <label className={fieldLabel}>
              Status
              <Select
                data-testid="transactions-status-filter"
                value={filters.status}
                onValueChange={(status) =>
                  update({ status: status as ExplorerStatus })
                }
                options={STATUS_OPTIONS}
                className={field}
              />
            </label>
            <label className={fieldLabel}>
              Inclusion
              <Select
                data-testid="transactions-inclusion-filter"
                value={filters.inclusion}
                onValueChange={(inclusion) =>
                  update({ inclusion: inclusion as ExplorerInclusion })
                }
                options={INCLUSION_OPTIONS}
                className={field}
              />
            </label>
          </div>
        )}

        <div
          data-testid="transactions-filter-chips"
          aria-label="Applied filters"
          className={
            filterChips.length > 0 ? "flex min-w-0 flex-wrap gap-2" : "sr-only"
          }
        >
          {filterChips.map((chip) => (
            <button
              key={chip.field}
              type="button"
              data-testid={`transactions-filter-chip-${chip.field}`}
              aria-label={`Remove ${chip.label} filter`}
              onClick={() => update(chip.clear)}
              className="border-line bg-panel focus-visible:outline-focus inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border px-3 text-xs focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <span className="truncate">{chip.label}</span>
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>

        <div className="border-line hidden items-center justify-between gap-3 border-t pt-4 md:flex">
          <div className="min-w-0">
            <p className="font-utility text-muted text-[.62rem] font-semibold tracking-[.14em] uppercase">
              Portable ledger
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
            tabIndex={0}
            aria-disabled={exportAvailable ? undefined : true}
            aria-busy={busy || undefined}
            aria-describedby="transactions-export-reason"
            onClick={(event) => {
              if (!exportAvailable) event.preventDefault();
            }}
            className={`${pill} hidden border-2 md:inline-flex ${
              exportAvailable
                ? "border-brand text-brand hover:bg-brand hover:text-on-accent"
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

      <TransactionFeed
        rows={rows}
        timeZone={model.timeZone}
        onSelect={selectTransaction}
        emptyState={emptyState}
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
        {canShowMore && (
          <button
            type="button"
            data-testid="transactions-show-more"
            onClick={() => void revealMore()}
            disabled={
              paginationLoading || busy || readModelQuery !== exportQuery
            }
            aria-busy={paginationLoading || undefined}
            className={`${pill} bg-mineral text-on-accent hover:bg-brand w-full disabled:cursor-wait disabled:opacity-65 md:w-auto`}
          >
            Show 10 more
          </button>
        )}
        <p
          data-testid="transactions-pagination-error"
          role="alert"
          className={
            paginationError ? "text-alert text-xs leading-5" : "sr-only"
          }
        >
          {paginationError}
        </p>
        {paginationError && (
          <button
            type="button"
            data-testid="transactions-pagination-retry"
            onClick={() => void revealMore()}
            disabled={paginationLoading}
            className={`${pill} border-alert text-alert border disabled:opacity-65`}
          >
            Retry
          </button>
        )}
      </div>

      <p
        data-testid="transactions-pagination-status"
        role="status"
        aria-live="polite"
        className="sr-only"
      >
        {paginationStatus}
      </p>

      <TransactionDetailSheet
        selection={detailSelection}
        onClose={() => setDetailSelection(null)}
      />
    </section>
  );
}
