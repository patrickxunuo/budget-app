"use client";
import { useEffect, useRef, useState } from "react";
import type {
  DashboardReadModel,
  DashboardPeriod,
  DashboardScope,
} from "@/lib/dashboard/types";
import { moveReference } from "@/lib/dashboard/domain";
const cad = (c: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(
    c / 100,
  );
const dateLabel = (s: string, e: string) =>
  `${new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${s}T00:00:00Z`))} to ${new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${e}T00:00:00Z`))}`;
export function FinancialDashboard({
  initialModel,
}: {
  initialModel: DashboardReadModel;
}) {
  const [model, setModel] = useState(initialModel),
    [scope, setScope] = useState<DashboardScope>(initialModel.scope),
    [period, setPeriod] = useState<DashboardPeriod>(initialModel.period),
    [reference, setReference] = useState(initialModel.range.endDate),
    [from, setFrom] = useState(initialModel.range.startDate),
    [to, setTo] = useState(initialModel.range.endDate),
    [search, setSearch] = useState(""),
    [accountId, setAccount] = useState(""),
    [categoryId, setCategory] = useState(""),
    [status, setStatus] = useState("all"),
    [inclusion, setInclusion] = useState("default"),
    [loading, setLoading] = useState(false),
    [exportQuerySnapshot, setExportQuerySnapshot] = useState(() => {
      const initial = new URLSearchParams({
        scope: initialModel.scope,
        period: initialModel.period,
        reference: initialModel.range.endDate,
        status: "all",
        inclusion: "default",
      });
      if (initialModel.period === "custom") {
        initial.set("from", initialModel.range.startDate);
        initial.set("to", initialModel.range.endDate);
      }
      return initial.toString();
    }),
    [error, setError] = useState(""),
    [refreshNonce, setRefreshNonce] = useState(0),
    [appliedCustomRange, setAppliedCustomRange] = useState({
      from: initialModel.range.startDate,
      to: initialModel.range.endDate,
    });
  const first = useRef(true),
    displayedModel = useRef(initialModel),
    request = useRef(0);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = ++request.current;
    setLoading(true);
    setError("");
    const timer = setTimeout(
      async () => {
        const q = new URLSearchParams({
          scope,
          period,
          reference,
          status,
          inclusion,
        });
        if (period === "custom") {
          q.set("from", appliedCustomRange.from);
          q.set("to", appliedCustomRange.to);
        }
        if (search.trim()) q.set("search", search.trim());
        if (accountId) q.set("accountId", accountId);
        if (categoryId) q.set("categoryId", categoryId);
        try {
          const r = await fetch(`/api/dashboard?${q}`, {
            headers: { accept: "application/json" },
          });
          const body = await r.json();
          if (!r.ok)
            throw new Error(
              typeof body.error === "string"
                ? body.error
                : "Dashboard refresh failed. Try again.",
            );
          if (id === request.current) {
            displayedModel.current = body;
            setExportQuerySnapshot(q.toString());
            setModel(body);
            setFrom(body.range.startDate);
            setTo(body.range.endDate);
          }
        } catch (e) {
          if (id === request.current) {
            const message =
              e instanceof Error ? e.message : "Dashboard refresh failed.";
            setError(
              `${/try again/i.test(message) ? message : `${message} Try again.`} Showing retained ${displayedModel.current.scope} data.`,
            );
          }
        } finally {
          if (id === request.current) setLoading(false);
        }
      },
      search ? 120 : 0,
    );
    return () => clearTimeout(timer);
  }, [
    scope,
    period,
    reference,
    accountId,
    categoryId,
    status,
    inclusion,
    search,
    appliedCustomRange,
    refreshNonce,
  ]);
  const navigate = (direction: -1 | 1) =>
    setReference(
      moveReference(
        reference,
        period,
        direction,
        model.range.startDate,
        model.range.endDate,
      ),
    );
  const exportHref = `/api/transactions/export?${exportQuerySnapshot}`;
  return (
    <main className="min-w-0 overflow-x-hidden px-4 py-8 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <header className="border-line grid gap-6 border-b pb-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="font-utility text-brand text-xs font-semibold tracking-[.16em] uppercase">
              Financial field report / Canadian dollars
            </p>
            <h1 className="font-display mt-3 text-5xl leading-[.92] font-semibold tracking-[-.055em] sm:text-6xl">
              Household money, in its proper boundaries.
            </h1>
            <p className="text-muted mt-4 max-w-2xl text-sm leading-6">
              Family is shared. Personal is visible only to you. There is
              deliberately no combined view.
            </p>
          </div>
          <div
            className="border-line bg-panel flex rounded-full border p-1"
            aria-label="Privacy scope"
          >
            {(["family", "personal"] as const).map((s) => (
              <button
                key={s}
                data-testid={`dashboard-scope-${s}`}
                aria-pressed={model.scope === s}
                onClick={() => {
                  setAccount("");
                  setCategory("");
                  setScope(s);
                  setRefreshNonce((value) => value + 1);
                }}
                className={`focus-visible:outline-brand rounded-full px-5 py-2 text-sm font-semibold capitalize focus-visible:outline-2 focus-visible:outline-offset-2 ${model.scope === s ? "bg-brand text-surface" : "text-muted"}`}
              >
                {s}
              </button>
            ))}
          </div>
        </header>
        <section className="border-line bg-surface mt-6 rounded-2xl border p-4">
          <div className="flex flex-wrap gap-2" aria-label="Accounting period">
            {(["day", "week", "month", "custom"] as const).map((p) => (
              <button
                key={p}
                data-testid={`dashboard-period-${p}`}
                aria-label={
                  p === "week" ? "Week, Monday through Sunday" : `${p} period`
                }
                aria-pressed={period === p}
                onClick={() => setPeriod(p)}
                className="border-line focus-visible:outline-brand rounded-full border px-4 py-2 text-sm capitalize focus-visible:outline-2"
              >
                {p}
              </button>
            ))}
            <button
              data-testid="dashboard-previous-period"
              aria-label="Previous period"
              onClick={() => navigate(-1)}
              className="ml-auto rounded-full border px-4"
            >
              Previous
            </button>
            <button
              data-testid="dashboard-next-period"
              aria-label="Next period"
              onClick={() => navigate(1)}
              className="rounded-full border px-4"
            >
              Next
            </button>
          </div>
          {period === "custom" && (
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="text-sm">
                From
                <input
                  aria-label="From"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="border-line ml-2 rounded-lg border bg-transparent p-2"
                />
              </label>
              <label className="text-sm">
                To
                <input
                  aria-label="To"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="border-line ml-2 rounded-lg border bg-transparent p-2"
                />
              </label>
              <button
                onClick={() => {
                  setReference(to);
                  setAppliedCustomRange({ from, to });
                }}
                className="bg-brand text-surface rounded-full px-5 py-2 font-semibold"
              >
                Apply custom range
              </button>
            </div>
          )}
          <p className="font-display mt-5 text-2xl font-semibold">
            {dateLabel(model.range.startDate, model.range.endDate)}
          </p>
        </section>
        <div
          data-testid="dashboard-loading"
          aria-live="polite"
          className="text-mineral min-h-6 py-2 text-sm"
        >
          {loading ? "Refreshing every region..." : ""}
        </div>
        {error && (
          <div
            data-testid="dashboard-error"
            role="alert"
            className="border-alert text-alert mb-4 rounded-xl border p-4"
          >
            {error}
          </div>
        )}
        <section
          aria-label="Cash flow summary"
          className="border-line bg-line grid gap-px overflow-hidden rounded-2xl border sm:grid-cols-2 lg:grid-cols-4"
        >
          {[
            ["Income", model.summary.incomeCents, "dashboard-summary-income"],
            [
              "Spending",
              model.summary.spendingCents,
              "dashboard-summary-spending",
            ],
            ["Net flow", model.summary.netFlowCents, "dashboard-summary-net"],
          ].map(([l, v, id]) => (
            <article key={id as string} className="bg-surface p-5">
              <p className="font-utility text-muted text-[.65rem] tracking-[.14em] uppercase">
                {l}
              </p>
              <p
                data-testid={id as string}
                className="font-display mt-8 text-3xl font-semibold tabular-nums"
              >
                {cad(v as number)}
              </p>
            </article>
          ))}
          <article className="bg-panel p-5">
            <p className="font-utility text-muted text-[.65rem] tracking-[.14em] uppercase">
              Pending
            </p>
            <p
              data-testid="dashboard-summary-pending"
              className="font-display mt-8 text-3xl font-semibold"
            >
              {cad(model.summary.pendingAmountCents)} 路{" "}
              {model.summary.pendingCount} pending
            </p>
          </article>
        </section>
        <div className="mt-8 grid min-w-0 gap-6 lg:grid-cols-[1.45fr_.75fr]">
          <section
            data-testid="dashboard-cash-flow-chart"
            className="border-line bg-surface rounded-2xl border p-5"
          >
            <h2 className="font-display text-2xl font-semibold">
              Cash-flow cadence
            </h2>
            <div className="mt-5 flex h-28 items-end gap-2" aria-hidden="true">
              {model.trend.map((d) => (
                <div key={d.date} className="flex flex-1 items-end gap-1">
                  <i
                    title={`Income ${cad(d.incomeCents)}`}
                    className="bg-brand block w-1/2 rounded-t"
                    style={{
                      height: `${Math.max(3, Math.min(100, (d.incomeCents / Math.max(1, ...model.trend.flatMap((x) => [x.incomeCents, x.spendingCents]))) * 100))}%`,
                    }}
                  />
                  <i
                    title={`Spending ${cad(d.spendingCents)}`}
                    className="bg-mineral block w-1/2 rounded-t"
                    style={{
                      height: `${Math.max(3, Math.min(100, (d.spendingCents / Math.max(1, ...model.trend.flatMap((x) => [x.incomeCents, x.spendingCents]))) * 100))}%`,
                    }}
                  />
                </div>
              ))}
            </div>
            <table className="mt-5 w-full text-left text-sm">
              <caption className="sr-only">
                Daily income and spending in Canadian dollars
              </caption>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Income</th>
                  <th>Spending</th>
                </tr>
              </thead>
              <tbody>
                {model.trend.map((d) => (
                  <tr key={d.date}>
                    <td>{d.date}</td>
                    <td>{cad(d.incomeCents)}</td>
                    <td>{cad(d.spendingCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section
            data-testid="dashboard-account-list"
            className="border-line bg-panel rounded-2xl border p-5"
          >
            <h2 className="font-display text-2xl font-semibold">
              Provider balance notes
            </h2>
            {model.accounts.map((a) => (
              <article key={a.id} className="border-line mt-4 border-t pt-4">
                <h3 className="font-semibold">
                  {a.name} {a.mask && `ending in ${a.mask}`}
                </h3>
                <p className="mt-1 text-xl tabular-nums">
                  Available:{" "}
                  {a.availableCents === null
                    ? "Unavailable"
                    : cad(a.availableCents)}
                </p>
                <p className="text-muted mt-1 text-sm tabular-nums">
                  Current:{" "}
                  {a.currentCents === null
                    ? "Unavailable"
                    : cad(a.currentCents)}
                </p>
                <p className="text-muted text-xs">
                  {a.freshnessAt
                    ? `Updated ${new Date(a.freshnessAt).toLocaleString("en-CA")}`
                    : "Freshness unavailable"}
                </p>
              </article>
            ))}
          </section>
        </div>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <section
            data-testid="dashboard-category-list"
            className="border-line bg-surface rounded-2xl border p-5"
          >
            <h2 className="font-display text-2xl font-semibold">
              Category field notes
            </h2>
            {model.categories.map((c) => (
              <p key={c.id} className="mt-3 flex justify-between">
                <span>{c.name}</span>
                <strong>{cad(c.spendingCents)}</strong>
              </p>
            ))}
          </section>
          <section
            data-testid="dashboard-budget-list"
            className="border-line bg-surface rounded-2xl border p-5"
          >
            <h2 className="font-display text-2xl font-semibold">
              Budget markers
            </h2>
            {model.categories
              .filter((c) => c.budgetCents !== null)
              .map((c) => (
                <p key={c.id} className="mt-3">
                  <strong>{c.name}</strong> 路 {c.progressPercent}%{" "}
                  {c.progressPercent !== null && c.progressPercent > 100
                    ? "鈥?over budget"
                    : "used"}
                </p>
              ))}
          </section>
        </div>
        <section className="border-line bg-surface mt-6 rounded-2xl border p-4">
          <div className="border-line mb-4 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
            <div>
              <p className="font-utility text-muted text-[.65rem] tracking-[.14em] uppercase">
                Portable ledger
              </p>
              <p className="text-muted text-sm">
                Download this exact scoped and filtered view as a safe UTF-8
                CSV.
              </p>
            </div>
            <a
              data-testid="dashboard-export-csv"
              href={loading ? undefined : exportHref}
              aria-disabled={loading}
              aria-busy={loading}
              onClick={(event) => loading && event.preventDefault()}
              className={`focus-visible:outline-brand rounded-full border px-5 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 ${loading ? "border-line text-muted pointer-events-none opacity-60" : "border-brand text-brand hover:bg-brand hover:text-surface"}`}
            >
              {loading ? "Preparing view…" : "Export CSV"}
            </a>
          </div>
          <div className="grid gap-3 md:grid-cols-5">
            <input
              data-testid="dashboard-search"
              aria-label="Search transactions and accounts"
              placeholder="Search ledger"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-line rounded-lg border bg-transparent p-3"
            />
            <Select
              id="dashboard-account-filter"
              label="Account filter"
              value={accountId}
              set={setAccount}
              options={model.filterOptions.accounts}
            />
            <Select
              id="dashboard-category-filter"
              label="Category filter"
              value={categoryId}
              set={setCategory}
              options={model.filterOptions.categories}
            />
            <Select
              id="dashboard-status-filter"
              label="Status filter"
              value={status}
              set={setStatus}
              includeBlank={false}
              options={[
                { id: "all", name: "All statuses" },
                { id: "pending", name: "Pending" },
                { id: "posted", name: "Posted" },
              ]}
            />
            <Select
              id="dashboard-inclusion-filter"
              label="Inclusion filter"
              value={inclusion}
              set={setInclusion}
              includeBlank={false}
              options={[
                { id: "default", name: "Included by default" },
                { id: "included", name: "Included" },
                { id: "excluded", name: "Excluded" },
                { id: "transfers", name: "Transfers" },
                { id: "all", name: "All lines" },
              ]}
            />
          </div>
        </section>
        <section
          data-testid="dashboard-transaction-list"
          className="border-line bg-surface mt-6 w-full max-w-full overflow-x-hidden rounded-2xl border"
        >
          <h2 className="font-display p-5 text-2xl font-semibold">
            Transaction observations
          </h2>
          {model.transactions.map((r) => (
            <article
              key={r.id}
              className="border-line grid gap-2 border-t p-5 sm:grid-cols-[1fr_auto]"
            >
              <div>
                <h3 className="font-semibold">{r.merchantOrDescription}</h3>
                <p className="text-muted text-xs">
                  {r.date} 路 {r.source} 路 {r.scope} privacy 路{" "}
                  {r.pending ? "Pending" : "Posted"} 路 {r.kind}
                  {r.excluded ? " 路 Excluded" : ""}
                </p>
                <p className="text-muted text-xs">
                  {r.accountName ?? "Off-bank manual entry"} 路{" "}
                  {r.category?.name ?? "Uncategorized"}
                </p>
              </div>
              <strong className="font-display text-xl tabular-nums">
                {cad(r.amountCents)}
              </strong>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
function Select({
  id,
  label,
  value,
  set,
  options,
  includeBlank = true,
}: {
  id: string;
  label: string;
  value: string;
  set: (v: string) => void;
  options: Array<{ id: string; name: string }>;
  includeBlank?: boolean;
}) {
  return (
    <select
      data-testid={id}
      aria-label={label}
      value={value}
      onChange={(e) => set(e.target.value)}
      className="border-line min-w-0 rounded-lg border bg-transparent p-3"
    >
      {includeBlank && <option value="">All</option>}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
