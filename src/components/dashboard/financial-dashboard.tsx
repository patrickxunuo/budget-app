"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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

function niceChartStep(range: number) {
  const rough = Math.max(range, 100) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / magnitude;
  const niceFraction =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * magnitude;
}

function compactCad(cents: number) {
  if (cents === 0) return "$0";
  const dollars = Math.abs(cents) / 100;
  const sign = cents < 0 ? "-" : "";
  const trim = (value: number) =>
    value.toFixed(value >= 10 || Number.isInteger(value) ? 0 : 1);
  if (dollars >= 1_000_000) return `${sign}$${trim(dollars / 1_000_000)}m`;
  if (dollars >= 1_000) return `${sign}$${trim(dollars / 1_000)}k`;
  return `${sign}$${trim(dollars)}`;
}

function readingDate(date: string) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function comparisonCopy(currentCents: number, baselineCents: number) {
  const difference = currentCents - baselineCents;
  if (difference === 0) return "$0 at baseline";
  return `${money(Math.abs(difference))} ${
    difference > 0 ? "above" : "below"
  } baseline`;
}

function subscribeToViewport(callback: () => void) {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
}

function wideViewportSnapshot() {
  return window.innerWidth >= 640;
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
  const rawMinimum = Math.min(0, ...values);
  const rawMaximum = Math.max(0, ...values);
  const step = niceChartStep(rawMaximum - rawMinimum);
  const minimum = Math.floor(rawMinimum / step) * step;
  let maximum = Math.ceil(rawMaximum / step) * step;
  if (maximum === minimum) maximum += step;

  const width = 640;
  const height = 292;
  const plotLeft = 68;
  const plotRight = 622;
  const plotTop = 18;
  const plotBottom = 230;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const latestDay = Math.max(1, points.at(-1)?.day ?? 1);
  const xForDay = (day: number) =>
    plotLeft +
    (latestDay === 1 ? 0 : ((day - 1) / (latestDay - 1)) * plotWidth);
  const yForValue = (value: number) =>
    plotTop + ((maximum - value) / (maximum - minimum)) * plotHeight;
  const path = (pick: (point: (typeof points)[number]) => number | null) => {
    const commands: string[] = [];
    let segmentStarted = false;
    points.forEach((point) => {
      const value = pick(point);
      if (value === null) {
        segmentStarted = false;
        return;
      }
      commands.push(
        `${segmentStarted ? "L" : "M"}${xForDay(point.day).toFixed(2)},${yForValue(value).toFixed(2)}`,
      );
      segmentStarted = true;
    });
    return commands.join(" ");
  };
  const ticks: number[] = [];
  for (let value = minimum; value <= maximum + step / 2; value += step) {
    ticks.push(Object.is(value, -0) ? 0 : value);
  }
  const xTicks = (target: number) => {
    const count = Math.min(target, latestDay);
    if (count <= 1) return [1];
    return Array.from(
      new Set(
        Array.from({ length: count }, (_, index) =>
          Math.round(1 + (index / (count - 1)) * (latestDay - 1)),
        ),
      ),
    );
  };
  const singlePoint =
    points.length === 1
      ? {
          x: xForDay(points[0]!.day),
          currentY: yForValue(points[0]!.currentCumulativeCents),
          baselineY:
            points[0]!.baselineAverageCents === null
              ? null
              : yForValue(points[0]!.baselineAverageCents),
        }
      : null;

  return {
    width,
    height,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    xForDay,
    yForValue,
    yTicks: ticks,
    narrowXTicks: xTicks(4),
    wideXTicks: xTicks(6),
    current: path((point) => point.currentCumulativeCents),
    baseline: path((point) => point.baselineAverageCents),
    singlePoint,
  };
}

function SpendingHistoryChart({
  points,
}: {
  points: DashboardOverviewReadModel["comparison"]["points"];
}) {
  const chart = chartGeometry(points);
  const isWideViewport = useSyncExternalStore(
    subscribeToViewport,
    wideViewportSnapshot,
    () => false,
  );
  const xTicks = isWideViewport ? chart.wideXTicks : chart.narrowXTicks;
  const plotRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<{
    index: number;
    mode: "hover" | "touch" | "keyboard";
  } | null>(null);

  useEffect(() => {
    const dismissOutside = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Node &&
        plotRef.current &&
        !plotRef.current.contains(target)
      ) {
        setActive(null);
      }
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("touchstart", dismissOutside, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("touchstart", dismissOutside, true);
    };
  }, []);

  const nearestIndex = (clientX: number) => {
    if (points.length <= 1) return 0;
    const bounds = plotRef.current?.getBoundingClientRect();
    const renderedWidth = bounds?.width || chart.width;
    const offset = bounds?.width ? clientX - bounds.left : clientX;
    const svgX =
      Math.max(0, Math.min(renderedWidth, offset)) *
      (chart.width / renderedWidth);
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    points.forEach((point, index) => {
      const distance = Math.abs(chart.xForDay(point.day) - svgX);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    return closestIndex;
  };

  const activePoint = active ? points[active.index] : undefined;
  const activeX = activePoint ? chart.xForDay(activePoint.day) : 0;
  const activeCurrentY = activePoint
    ? chart.yForValue(activePoint.currentCumulativeCents)
    : 0;
  const activeBaselineY =
    activePoint?.baselineAverageCents == null
      ? null
      : chart.yForValue(activePoint.baselineAverageCents);
  const deltaCopy =
    activePoint?.baselineAverageCents == null
      ? null
      : comparisonCopy(
          activePoint.currentCumulativeCents,
          activePoint.baselineAverageCents,
        );
  const reading = activePoint
    ? [
        readingDate(activePoint.date),
        `This month ${money(activePoint.currentCumulativeCents)}.`,
        ...(activePoint.baselineAverageCents === null
          ? []
          : [
              `Baseline ${money(activePoint.baselineAverageCents)}.`,
              `${deltaCopy}.`,
            ]),
      ].join(" ")
    : "";

  const selectPointer = (clientX: number, mode: "hover" | "touch") => {
    if (points.length === 0) return;
    setActive({ index: nearestIndex(clientX), mode });
  };

  return (
    <>
      <div
        ref={plotRef}
        data-testid="dashboard-comparison-plot"
        tabIndex={0}
        aria-label="Inspect spending history by day"
        aria-describedby="dashboard-comparison-reading"
        className="focus-visible:outline-brand relative mt-4 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4"
        style={{ touchAction: "pan-y" }}
        onPointerDown={(event) =>
          selectPointer(
            event.clientX,
            event.pointerType === "touch" ? "touch" : "hover",
          )
        }
        onPointerMove={(event) => {
          if (event.pointerType === "touch") {
            selectPointer(event.clientX, "touch");
            return;
          }
          if (active?.mode !== "touch") selectPointer(event.clientX, "hover");
        }}
        onMouseMove={(event) => {
          if (active?.mode !== "touch") selectPointer(event.clientX, "hover");
        }}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          if (touch) selectPointer(touch.clientX, "touch");
        }}
        onPointerLeave={() =>
          setActive((current) => (current?.mode === "hover" ? null : current))
        }
        onMouseLeave={() =>
          setActive((current) => (current?.mode === "hover" ? null : current))
        }
        onFocus={() => {
          if (points.length > 0) {
            setActive((current) => current ?? { index: 0, mode: "keyboard" });
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setActive(null);
            return;
          }
          const direction =
            event.key === "ArrowLeft" || event.key === "ArrowDown"
              ? -1
              : event.key === "ArrowRight" || event.key === "ArrowUp"
                ? 1
                : 0;
          if (direction === 0 || points.length === 0) return;
          event.preventDefault();
          setActive((current) => ({
            index: Math.max(
              0,
              Math.min(
                points.length - 1,
                (current?.index ?? (direction > 0 ? -1 : 1)) + direction,
              ),
            ),
            mode: "keyboard",
          }));
        }}
      >
        <svg
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          aria-hidden="true"
          className="block h-auto w-full overflow-visible"
        >
          <g>
            {chart.yTicks.map((tick) => {
              const y = chart.yForValue(tick);
              return (
                <g key={tick}>
                  <line
                    x1={chart.plotLeft}
                    x2={chart.plotRight}
                    y1={y}
                    y2={y}
                    stroke={tick === 0 ? "var(--line)" : "var(--line-soft)"}
                    strokeWidth={tick === 0 ? 1.25 : 1}
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    data-testid="dashboard-comparison-y-tick"
                    x={chart.plotLeft - 11}
                    y={y}
                    dy="0.32em"
                    textAnchor="end"
                    fill="var(--muted)"
                    fontSize="12"
                    className="tabular-nums"
                  >
                    {compactCad(tick)}
                  </text>
                </g>
              );
            })}
          </g>

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
                cx={chart.singlePoint.x}
                cy={chart.singlePoint.currentY}
                r="5"
                fill="var(--brand)"
              />
            </>
          ) : null}

          {activePoint ? (
            <g>
              <line
                data-testid="dashboard-comparison-guide"
                x1={activeX}
                x2={activeX}
                y1={chart.plotTop}
                y2={chart.plotBottom}
                stroke="var(--ink)"
                strokeWidth="1.5"
                strokeDasharray="3 5"
                opacity="0.58"
                vectorEffect="non-scaling-stroke"
              />
              {activeBaselineY !== null ? (
                <circle
                  data-testid="dashboard-comparison-active-baseline-marker"
                  cx={activeX}
                  cy={activeBaselineY}
                  r="7"
                  fill="var(--surface)"
                  stroke="var(--mineral)"
                  strokeWidth="4"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              <circle
                data-testid="dashboard-comparison-active-current-marker"
                cx={activeX}
                cy={activeCurrentY}
                r="6"
                fill="var(--surface)"
                stroke="var(--brand)"
                strokeWidth="4"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ) : null}

          <g>
            {xTicks.map((day) => (
              <text
                key={day}
                data-testid="dashboard-comparison-x-tick"
                x={chart.xForDay(day)}
                y={chart.plotBottom + 24}
                textAnchor={
                  day === 1 ? "start" : day === xTicks.at(-1) ? "end" : "middle"
                }
                fill="var(--muted)"
                fontSize="12"
                className="tabular-nums"
              >
                {day}
              </text>
            ))}
          </g>

          <text
            data-testid="dashboard-comparison-x-axis-title"
            x={(chart.plotLeft + chart.plotRight) / 2}
            y={chart.height - 5}
            textAnchor="middle"
            fill="var(--ink)"
            fontSize="12"
            fontWeight="600"
          >
            Day of month
          </text>
          <text
            data-testid="dashboard-comparison-y-axis-title"
            x={-(chart.plotTop + chart.plotBottom) / 2}
            y="15"
            transform="rotate(-90)"
            textAnchor="middle"
            fill="var(--ink)"
            fontSize="12"
            fontWeight="600"
          >
            Cumulative spending (CAD)
          </text>
        </svg>

        {activePoint ? (
          <div
            data-testid="dashboard-comparison-tooltip"
            data-side={activeX > chart.width * 0.68 ? "left" : "right"}
            className={`border-line bg-panel pointer-events-none absolute top-3 z-10 w-[min(15rem,72%)] rounded-xl border px-3 py-2.5 shadow-lg ${
              activeX > chart.width * 0.68 ? "-ml-2 -translate-x-full" : "ml-2"
            }`}
            style={{ left: `${(activeX / chart.width) * 100}%` }}
          >
            <p className="text-ink text-xs font-semibold">
              {readingDate(activePoint.date)}
            </p>
            <dl className="mt-2 space-y-1 text-xs tabular-nums">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">This month</dt>
                <dd className="text-ink font-semibold">
                  {money(activePoint.currentCumulativeCents)}
                </dd>
              </div>
              {activePoint.baselineAverageCents !== null ? (
                <>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Baseline</dt>
                    <dd className="text-ink font-semibold">
                      {money(activePoint.baselineAverageCents)}
                    </dd>
                  </div>
                  <div className="border-line-soft mt-1 border-t pt-1">
                    <dt className="sr-only">Comparison</dt>
                    <dd className="text-muted font-medium">{deltaCopy}</dd>
                  </div>
                </>
              ) : null}
            </dl>
          </div>
        ) : null}
      </div>

      <p
        id="dashboard-comparison-reading"
        data-testid="dashboard-comparison-reading"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {reading}
      </p>
    </>
  );
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
  const dailyValuesDisclosure = useRef<HTMLDetailsElement>(null);

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

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const wideViewport = window.matchMedia("(min-width: 64rem)");
    const synchronizeDisclosure = () => {
      if (dailyValuesDisclosure.current) {
        dailyValuesDisclosure.current.open = wideViewport.matches;
      }
    };
    synchronizeDisclosure();
    wideViewport.addEventListener?.("change", synchronizeDisclosure);
    return () =>
      wideViewport.removeEventListener?.("change", synchronizeDisclosure);
  }, []);

  const health = model.budgetHealth;
  const pace = health.pace ?? "unavailable";
  const progressWidth = Math.max(
    0,
    Math.min(100, health.progressPercent ?? health.expectedPercent),
  );

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-w-0 overflow-x-hidden px-4 py-4 sm:px-8 sm:py-6 lg:px-12"
    >
      <div className="mx-auto max-w-7xl">
        <section
          data-testid="dashboard-heading"
          aria-label="Overview period and privacy scope"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <p className="font-display text-ink text-lg font-semibold tracking-[-.02em] sm:text-xl">
            {monthLabel(model.asOfDate)}
          </p>
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
                className={`focus-visible:outline-brand min-h-11 min-w-20 rounded-full px-4 py-2 text-sm font-semibold capitalize focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  model.scope === value
                    ? "bg-brand text-on-accent"
                    : "text-muted hover:text-ink"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </section>

        <div
          data-testid="dashboard-loading"
          role="status"
          aria-live="polite"
          className="text-mineral min-h-5 py-0.5 text-xs"
        >
          {loading ? `Refreshing ${scope} overview…` : ""}
        </div>
        {error ? (
          <div
            data-testid="dashboard-error"
            role="alert"
            className="border-alert text-alert mb-3 rounded-lg border px-3 py-2 text-sm"
          >
            {error}
          </div>
        ) : null}

        <section
          data-testid="dashboard-budget-health"
          aria-labelledby="budget-health-title"
          className="border-line bg-surface overflow-hidden rounded-2xl border"
        >
          <div className="p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2
                id="budget-health-title"
                className="font-display text-xl font-semibold sm:text-2xl"
              >
                Budget
              </h2>
              <div
                data-testid="dashboard-budget-pace"
                data-pace={pace}
                className="border-line bg-panel flex min-h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold"
              >
                <PaceShape pace={health.pace} />
                <span>{paceCopy(health.pace)}</span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3 sm:gap-6">
              <div className="min-w-0">
                <p className="text-muted text-xs">
                  {health.hasBudgets ? "Spent" : "Spent this month"}
                </p>
                <p
                  data-testid="dashboard-budget-spent"
                  className="font-display mt-1 text-2xl leading-none font-semibold tracking-[-.035em] tabular-nums sm:text-4xl"
                >
                  {money(health.spentCents)}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-muted text-xs">Target</p>
                <p
                  data-testid="dashboard-budget-target"
                  className="font-display mt-1 text-base leading-tight font-semibold tabular-nums sm:text-xl"
                >
                  {health.hasBudgets
                    ? money(health.targetCents)
                    : "No budget set"}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-muted text-xs">Remaining</p>
                <p
                  data-testid="dashboard-budget-remaining"
                  className="font-display mt-1 text-base leading-tight font-semibold tabular-nums sm:text-xl"
                >
                  {health.hasBudgets
                    ? money(health.remainingCents)
                    : "Not available"}
                </p>
              </div>
            </div>

            <div className="mt-4">
              <div className="bg-panel h-2 overflow-hidden rounded-full">
                <span
                  aria-hidden="true"
                  className="bg-brand block h-full rounded-full"
                  style={{ width: `${progressWidth}%` }}
                />
              </div>
              <div className="text-muted mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs tabular-nums">
                <span>
                  {health.hasBudgets
                    ? `${Math.round(health.progressPercent ?? 0)}% used`
                    : "No target for this scope"}
                </span>
                <span>
                  {Math.round(health.expectedPercent)}% of month elapsed
                </span>
              </div>
            </div>
          </div>

          <div className="border-line bg-panel flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 sm:px-6">
            <p
              data-testid="dashboard-budget-days"
              className="font-display text-lg font-semibold tabular-nums"
            >
              Day {health.daysElapsed} of {health.daysInMonth}
            </p>
            <p className="text-muted text-xs">
              {health.daysRemaining === 0
                ? "Month closes today."
                : `${health.daysRemaining} days remain.`}
            </p>
          </div>
        </section>

        <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[1.55fr_.75fr] lg:gap-6">
          <section
            data-testid="dashboard-account-list"
            aria-labelledby="accounts-title"
            className="border-line bg-panel min-w-0 rounded-2xl border p-4 sm:p-6 lg:order-2"
          >
            <h2
              id="accounts-title"
              className="font-display text-xl font-semibold sm:text-2xl"
            >
              Accounts
            </h2>
            {model.accounts.length === 0 ? (
              <p className="text-muted border-line mt-4 border-t pt-4 text-sm">
                No accounts are visible in this scope.
              </p>
            ) : (
              <div className="mt-2">
                {model.accounts.map((account, index) => (
                  <article
                    key={account.id}
                    className={`py-3 ${index === 0 ? "" : "border-line border-t"}`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="truncate font-semibold">{account.name}</h3>
                      <span className="text-muted shrink-0 text-xs">
                        {account.mask ? `•••• ${account.mask}` : "No mask"}
                      </span>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-3">
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
                    <p className="text-muted mt-2 text-xs">
                      {account.subtype.replace("_", " ")} ·{" "}
                      {freshness(account.freshnessAt, model.timeZone)}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section
            data-testid="dashboard-comparison-chart"
            aria-labelledby="comparison-title"
            className="border-line bg-surface min-w-0 rounded-2xl border p-4 sm:p-6 lg:order-1"
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2
                id="comparison-title"
                className="font-display text-xl font-semibold sm:text-2xl"
              >
                Spending history
              </h2>
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
              className="text-muted mt-1 text-sm"
            >
              {baselineNote(model.comparison.baselineMonthCount)}
            </p>

            <SpendingHistoryChart
              key={model.comparison.points
                .map(
                  (point) =>
                    `${point.date}:${point.currentCumulativeCents}:${point.baselineAverageCents}`,
                )
                .join("|")}
              points={model.comparison.points}
            />

            <details
              ref={dailyValuesDisclosure}
              data-testid="dashboard-daily-values-disclosure"
              className="group border-line mt-4 border-t pt-3"
            >
              <summary className="text-ink flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold lg:hidden [&::-webkit-details-marker]:hidden">
                View daily values
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  className="size-4 group-open:rotate-180"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m4 6 4 4 4-4" />
                </svg>
              </summary>
              <div className="hidden overflow-x-auto group-open:block lg:block">
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
                      <tr
                        key={point.date}
                        className="border-line-soft border-t"
                      >
                        <th scope="row" className="py-1.5 font-medium">
                          {point.day}
                        </th>
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
            </details>
          </section>
        </div>
      </div>
    </main>
  );
}
