"use client";

import { useEffect, useRef, useState } from "react";
import type { DashboardOverviewReadModel } from "@/lib/dashboard/overview-types";
import type { DashboardScope } from "@/lib/dashboard/types";

const cad = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
});

function money(cents: number | null) {
  return cents === null ? "Unavailable" : cad.format(cents / 100);
}

function monthLabel(date: string) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function freshness(value: string | null, timeZone: string) {
  if (value === null) return "Freshness unavailable";
  return `Updated ${new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value))}`;
}

function baselineNote(count: 0 | 1 | 2 | 3) {
  if (count === 0) return "Recent spending history is unavailable.";
  if (count === 1) return "Compared with 1 available prior month.";
  if (count === 2) return "Compared with the average of 2 months.";
  return "Compared with the average of 3 months.";
}

function paceCopy(pace: DashboardOverviewReadModel["budgetHealth"]["pace"]) {
  if (pace === "under") return "Under expected pace";
  if (pace === "at") return "At expected pace";
  if (pace === "over") return "Over expected pace";
  return "Pace unavailable without a budget";
}

function PaceShape({
  pace,
}: {
  pace: DashboardOverviewReadModel["budgetHealth"]["pace"];
}) {
  if (pace === "under") {
    return (
      <span
        aria-hidden="true"
        className="border-mineral block size-3 rotate-45 border-r-2 border-b-2"
      />
    );
  }
  if (pace === "at") {
    return (
      <span
        aria-hidden="true"
        className="border-brand block size-3 rounded-full border-2"
      />
    );
  }
  if (pace === "over") {
    return (
      <span
        aria-hidden="true"
        className="border-alert block size-3 border-t-2 border-l-2"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="border-line block h-0.5 w-3 border-t-2"
    />
  );
}

function chartGeometry(
  points: DashboardOverviewReadModel["comparison"]["points"],
) {
  const values = points.flatMap((point) => [
    point.currentCumulativeCents,
    ...(point.baselineAverageCents === null
      ? []
      : [point.baselineAverageCents]),
  ]);
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const span = Math.max(1, maximum - minimum);
  const width = 640;
  const height = 228;
  const insetX = 22;
  const insetY = 18;
  const plotWidth = width - insetX * 2;
  const plotHeight = height - insetY * 2;
  const x = (index: number) =>
    points.length === 1
      ? insetX
      : insetX + (index / (points.length - 1)) * plotWidth;
  const y = (value: number) => insetY + ((maximum - value) / span) * plotHeight;
  const path = (pick: (point: (typeof points)[number]) => number | null) => {
    const commands: string[] = [];
    points.forEach((point, index) => {
      const value = pick(point);
      if (value === null) return;
      commands.push(
        `${commands.length === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(value).toFixed(2)}`,
      );
    });
    return commands.join(" ");
  };
  const singlePoint =
    points.length === 1
      ? {
          x: x(0),
          currentY: y(points[0]!.currentCumulativeCents),
          baselineY:
            points[0]!.baselineAverageCents === null
              ? null
              : y(points[0]!.baselineAverageCents),
        }
      : null;
  return {
    width,
    height,
    zeroY: y(0),
    current: path((point) => point.currentCumulativeCents),
    baseline: path((point) => point.baselineAverageCents),
    singlePoint,
  };
}

export function FinancialDashboard({
  initialModel,
}: {
  initialModel: DashboardOverviewReadModel;
}) {
  const [model, setModel] = useState(initialModel);
  const [scope, setScope] = useState<DashboardScope>(initialModel.scope);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const latestModel = useRef(initialModel);
  const requestId = useRef(0);

  useEffect(() => {
    if (scope === latestModel.current.scope) return;
    const id = ++requestId.current;
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError("");

    void (async () => {
      try {
        const response = await fetch(`/api/dashboard/overview?scope=${scope}`, {
          headers: { accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });
        const body = (await response.json()) as
          DashboardOverviewReadModel | { error?: unknown };
        if (!response.ok) {
          throw new Error(
            typeof (body as { error?: unknown }).error === "string"
              ? String((body as { error: string }).error)
              : "Dashboard refresh failed.",
          );
        }
        if (cancelled || id !== requestId.current) return;
        const next = body as DashboardOverviewReadModel;
        latestModel.current = next;
        setModel(next);
      } catch (caught) {
        if (
          cancelled ||
          controller.signal.aborted ||
          id !== requestId.current
        ) {
          return;
        }
        const message =
          caught instanceof Error
            ? caught.message
            : "Dashboard refresh failed.";
        const retryMessage = /try again/i.test(message)
          ? message
          : `${message} Try again.`;
        setError(
          `${retryMessage} Showing retained ${latestModel.current.scope} data.`,
        );
        setScope(latestModel.current.scope);
      } finally {
        if (!cancelled && id === requestId.current) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [scope]);

  const health = model.budgetHealth;
  const pace = health.pace ?? "unavailable";
  const chart = chartGeometry(model.comparison.points);
  const progressWidth = Math.max(
    0,
    Math.min(100, health.progressPercent ?? health.expectedPercent),
  );

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-w-0 overflow-x-hidden px-4 py-6 sm:px-8 sm:py-8 lg:px-12"
    >
      <div className="mx-auto max-w-7xl">
        <header
          data-testid="dashboard-heading"
          className="border-line grid gap-5 border-b pb-5 sm:grid-cols-[1fr_auto] sm:items-end"
        >
          <div>
            <p className="font-utility text-brand text-[.65rem] font-semibold tracking-[.18em] uppercase">
              Financial field note · {model.asOfDate}
            </p>
            <h1 className="font-display mt-2 text-3xl leading-none font-semibold tracking-[-.04em] sm:text-4xl">
              {monthLabel(model.asOfDate)}, at a glance.
            </h1>
            <p className="text-muted mt-2 max-w-xl text-sm leading-5">
              Month-to-date budget health, recent spending cadence, and account
              balances — kept inside the selected privacy boundary.
            </p>
          </div>
          <div
            className="border-line bg-panel grid grid-cols-2 rounded-full border p-1"
            aria-label="Privacy scope"
          >
            {(["family", "personal"] as const).map((value) => (
              <button
                key={value}
                type="button"
                data-testid={`dashboard-scope-${value}`}
                aria-pressed={model.scope === value}
                onClick={() => {
                  if (value === model.scope) {
                    requestId.current += 1;
                    setLoading(false);
                    setError("");
                  }
                  setScope(value);
                }}
                className={`focus-visible:outline-brand min-h-11 min-w-24 rounded-full px-5 py-2 text-sm font-semibold capitalize focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  model.scope === value
                    ? "bg-brand text-on-accent"
                    : "text-muted hover:text-ink"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </header>

        <div
          data-testid="dashboard-loading"
          role="status"
          aria-live="polite"
          className="text-mineral min-h-6 py-1 text-xs"
        >
          {loading ? `Refreshing ${scope} overview…` : ""}
        </div>
        {error ? (
          <div
            data-testid="dashboard-error"
            role="alert"
            className="border-alert text-alert mb-4 border-l-4 py-2 pl-3 text-sm"
          >
            {error}
          </div>
        ) : null}

        <section
          data-testid="dashboard-budget-health"
          aria-labelledby="budget-health-title"
          className="border-line bg-surface relative overflow-hidden rounded-2xl border"
        >
          <div className="grid lg:grid-cols-[1.3fr_.7fr]">
            <div className="p-5 sm:p-7 lg:p-9">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-utility text-muted text-[.65rem] font-semibold tracking-[.16em] uppercase">
                    Budget health / {model.scope}
                  </p>
                  <h2
                    id="budget-health-title"
                    className="font-display mt-1 text-xl font-semibold"
                  >
                    The month’s working margin
                  </h2>
                </div>
                <div
                  data-testid="dashboard-budget-pace"
                  data-pace={pace}
                  className="border-line bg-panel flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold"
                >
                  <PaceShape pace={health.pace} />
                  <span>{paceCopy(health.pace)}</span>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
                <div className="col-span-2 sm:col-span-1">
                  <p className="text-muted text-xs">
                    {health.hasBudgets
                      ? "Spent against plan"
                      : "Month-to-date spending"}
                  </p>
                  <p
                    data-testid="dashboard-budget-spent"
                    className="font-display mt-1 text-4xl leading-none font-semibold tracking-[-.045em] tabular-nums sm:text-5xl"
                  >
                    {money(health.spentCents)}
                  </p>
                </div>
                <div>
                  <p className="text-muted text-xs">Target</p>
                  <p
                    data-testid="dashboard-budget-target"
                    className="font-display mt-1 text-xl font-semibold tabular-nums"
                  >
                    {health.hasBudgets
                      ? money(health.targetCents)
                      : "No budget set"}
                  </p>
                </div>
                <div>
                  <p className="text-muted text-xs">Remaining</p>
                  <p
                    data-testid="dashboard-budget-remaining"
                    className="font-display mt-1 text-xl font-semibold tabular-nums"
                  >
                    {health.hasBudgets
                      ? money(health.remainingCents)
                      : "Not available"}
                  </p>
                </div>
              </div>

              <div className="mt-6">
                <div className="bg-panel h-2 overflow-hidden rounded-full">
                  <span
                    aria-hidden="true"
                    className="bg-brand block h-full rounded-full"
                    style={{ width: `${progressWidth}%` }}
                  />
                </div>
                <div className="text-muted mt-2 flex justify-between gap-4 text-xs tabular-nums">
                  <span>
                    {health.hasBudgets
                      ? `${Math.round(health.progressPercent ?? 0)}% used`
                      : "No aggregate target for this scope"}
                  </span>
                  <span>
                    {Math.round(health.expectedPercent)}% of month elapsed
                  </span>
                </div>
              </div>
            </div>

            <div className="border-line bg-panel border-t p-5 sm:p-7 lg:border-t-0 lg:border-l lg:p-9">
              <p className="font-utility text-muted text-[.65rem] font-semibold tracking-[.16em] uppercase">
                Calendar position
              </p>
              <p
                data-testid="dashboard-budget-days"
                className="font-display mt-3 text-3xl font-semibold tabular-nums"
              >
                Day {health.daysElapsed} of {health.daysInMonth}
              </p>
              <p className="text-muted mt-2 text-sm">
                {health.daysRemaining === 0
                  ? "Month closes today."
                  : `${health.daysRemaining} days remain · cumulative values stop at today.`}
              </p>
            </div>
          </div>
        </section>

        <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[1.55fr_.75fr]">
          <section
            data-testid="dashboard-comparison-chart"
            aria-labelledby="comparison-title"
            className="border-line bg-surface min-w-0 rounded-2xl border p-5 sm:p-7"
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="font-utility text-brand text-[.65rem] font-semibold tracking-[.16em] uppercase">
                  Cumulative field trace
                </p>
                <h2
                  id="comparison-title"
                  className="font-display mt-1 text-2xl font-semibold"
                >
                  Spending versus recent history
                </h2>
              </div>
              <div className="text-muted flex gap-4 text-xs">
                <span className="flex items-center gap-2">
                  <i aria-hidden="true" className="bg-brand h-0.5 w-5" />
                  This month
                </span>
                <span className="flex items-center gap-2">
                  <i
                    aria-hidden="true"
                    className="border-mineral h-0.5 w-5 border-t-2 border-dashed"
                  />
                  Baseline
                </span>
              </div>
            </div>
            <p
              data-testid="dashboard-baseline-note"
              className="text-muted mt-2 text-sm"
            >
              {baselineNote(model.comparison.baselineMonthCount)}
            </p>

            <svg
              viewBox={`0 0 ${chart.width} ${chart.height}`}
              aria-hidden="true"
              className="mt-5 block h-auto w-full"
            >
              {[0.25, 0.5, 0.75].map((fraction) => (
                <line
                  key={fraction}
                  x1="22"
                  x2="618"
                  y1={chart.height * fraction}
                  y2={chart.height * fraction}
                  stroke="var(--line-soft)"
                  strokeWidth="1"
                />
              ))}
              <line
                x1="22"
                x2="618"
                y1={chart.zeroY}
                y2={chart.zeroY}
                stroke="var(--line)"
                strokeWidth="1"
              />
              {chart.baseline ? (
                <path
                  d={chart.baseline}
                  fill="none"
                  stroke="var(--mineral)"
                  strokeWidth="4"
                  strokeDasharray="8 7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              <path
                d={chart.current}
                fill="none"
                stroke="var(--brand)"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              {chart.singlePoint ? (
                <>
                  {chart.singlePoint.baselineY !== null ? (
                    <circle
                      data-testid="dashboard-comparison-baseline-marker"
                      aria-hidden="true"
                      cx={chart.singlePoint.x}
                      cy={chart.singlePoint.baselineY}
                      r="7"
                      fill="var(--surface)"
                      stroke="var(--mineral)"
                      strokeWidth="4"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                  <circle
                    data-testid="dashboard-comparison-current-marker"
                    aria-hidden="true"
                    cx={chart.singlePoint.x}
                    cy={chart.singlePoint.currentY}
                    r="5"
                    fill="var(--brand)"
                  />
                </>
              ) : null}
            </svg>

            <div className="border-line mt-5 border-t pt-4">
              <table
                data-testid="dashboard-comparison-table"
                className="w-full table-fixed text-left text-xs tabular-nums sm:text-sm"
              >
                <caption className="sr-only">
                  Daily current cumulative spending and available-history
                  baseline in Canadian dollars
                </caption>
                <thead>
                  <tr className="text-muted">
                    <th className="w-1/4 pb-2 font-medium">Day</th>
                    <th className="w-3/8 pb-2 text-right font-medium">
                      Current
                    </th>
                    <th className="w-3/8 pb-2 text-right font-medium">
                      Baseline
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {model.comparison.points.map((point) => (
                    <tr key={point.date} className="border-line-soft border-t">
                      <th className="py-1.5 font-medium">{point.day}</th>
                      <td className="py-1.5 text-right">
                        {money(point.currentCumulativeCents)}
                      </td>
                      <td className="py-1.5 text-right">
                        {point.baselineAverageCents === null
                          ? "Unavailable"
                          : money(point.baselineAverageCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section
            data-testid="dashboard-account-list"
            aria-labelledby="accounts-title"
            className="border-line bg-panel min-w-0 rounded-2xl border p-5 sm:p-7"
          >
            <p className="font-utility text-muted text-[.65rem] font-semibold tracking-[.16em] uppercase">
              Account ledger
            </p>
            <h2
              id="accounts-title"
              className="font-display mt-1 text-2xl font-semibold"
            >
              Balance observations
            </h2>
            {model.accounts.length === 0 ? (
              <p className="text-muted border-line mt-5 border-t pt-4 text-sm">
                No accounts are visible in this scope.
              </p>
            ) : (
              <div className="mt-3">
                {model.accounts.map((account, index) => (
                  <article
                    key={account.id}
                    className={`py-4 ${index === 0 ? "" : "border-line border-t"}`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="font-semibold">{account.name}</h3>
                      <span className="text-muted text-xs">
                        {account.mask ? `•••• ${account.mask}` : "No mask"}
                      </span>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <dt className="text-muted text-[.65rem] uppercase">
                          Available
                        </dt>
                        <dd className="font-display mt-1 text-lg font-semibold tabular-nums">
                          {money(account.availableCents)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted text-[.65rem] uppercase">
                          Current
                        </dt>
                        <dd className="font-display mt-1 text-lg font-semibold tabular-nums">
                          {money(account.currentCents)}
                        </dd>
                      </div>
                    </dl>
                    <p className="text-muted mt-3 text-xs">
                      {account.subtype.replace("_", " ")} ·{" "}
                      {freshness(account.freshnessAt, model.timeZone)}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
