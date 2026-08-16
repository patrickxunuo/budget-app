"use client";
import { useState } from "react";
import { PendingButton } from "@/components/pending-button";
import { usePendingAction } from "@/hooks/use-pending-action";
import { moveMonth } from "@/lib/budgets/domain";
import type {
  BudgetMonthReadModel,
  BudgetProgress,
  BudgetScope,
} from "@/lib/budgets/types";
const cad = (c: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(
    c / 100,
  );
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("en-CA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}T00:00:00Z`));
const statusCopy = {
  "on-track": { icon: "\u25cf", label: "On track" },
  watch: { icon: "\u25c6", label: "Watch closely" },
  close: { icon: "\u25b2", label: "Close to limit" },
  "at-limit": { icon: "\u25a0", label: "At limit" },
  over: { icon: "!", label: "Over budget" },
} as const;
type Mode =
  { kind: "create" } | { kind: "edit"; budget: BudgetProgress } | null;
export function BudgetWorkbench({
  initialModel,
}: {
  initialModel: BudgetMonthReadModel;
}) {
  const [model, setModel] = useState(initialModel),
    [scope, setScope] = useState<BudgetScope>(initialModel.scope),
    [month, setMonth] = useState(initialModel.month),
    [mode, setMode] = useState<Mode>(null),
    [categoryId, setCategoryId] = useState(""),
    [amount, setAmount] = useState(""),
    [effectiveMonth, setEffectiveMonth] = useState(initialModel.month),
    [pendingAction, setPendingAction] = useState(""),
    [error, setError] = useState("");
  const { pending, run } = usePendingAction();
  const loading = pending;
  async function fetchModel(nextScope: BudgetScope, nextMonth: string) {
    const response = await fetch(
      `/api/budgets?scope=${nextScope}&month=${nextMonth}`,
      { headers: { accept: "application/json" } },
    );
    const body = await response.json();
    if (!response.ok)
      throw new Error(
        typeof body.error === "string"
          ? body.error
          : "Budget ledger could not be refreshed.",
      );
    return body as BudgetMonthReadModel;
  }
  async function changeView(nextScope: BudgetScope, nextMonth: string) {
    await run(async () => {
      setPendingAction(`view:${nextScope}:${nextMonth}`);
      setError("");
      try {
        const next = await fetchModel(nextScope, nextMonth);
        setModel(next);
        setScope(nextScope);
        setMonth(nextMonth);
        setMode(null);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Budget ledger could not be refreshed.",
        );
      }
    });
  }
  function openCreate() {
    setMode({ kind: "create" });
    setCategoryId(model.availableCategories[0]?.id ?? "");
    setAmount("");
    setEffectiveMonth(month);
    setError("");
  }
  function openEdit(budget: BudgetProgress) {
    setMode({ kind: "edit", budget });
    setCategoryId(budget.categoryId);
    setAmount((budget.amountCents / 100).toFixed(2));
    setEffectiveMonth(month);
    setError("");
  }
  async function mutate(
    path: string,
    method: "POST" | "PATCH",
    body: unknown,
    action: string,
  ) {
    await run(async () => {
      setPendingAction(action);
      setError("");
      try {
        const response = await fetch(path, {
          method,
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          let message = "Budget target could not be saved.";
          try {
            const payload = await response.json();
            if (typeof payload.error === "string") message = payload.error;
          } catch {
            // The status code still proves the mutation failed.
          }
          throw new Error(message);
        }

        // The mutation is committed. Close and clear the form before refreshing
        // so a read outage cannot invite an unsafe duplicate submission.
        setMode(null);
        setCategoryId("");
        setAmount("");
        setEffectiveMonth(month);
        try {
          setModel(await fetchModel(scope, month));
        } catch {
          setError(
            "Target was saved, but the refreshed ledger could not be loaded. Showing the previous monthly view; refresh before making another change.",
          );
        }
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Budget target could not be saved.",
        );
      }
    });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const dollars = Number(amount);
    const amountCents = Math.round(dollars * 100);
    if (
      !Number.isFinite(dollars) ||
      !Number.isSafeInteger(amountCents) ||
      amountCents <= 0 ||
      Math.abs(dollars * 100 - amountCents) > 0.00001
    ) {
      setError(
        "Enter a positive CAD amount with no more than two decimal places.",
      );
      return;
    }
    if (mode?.kind === "edit")
      await mutate(
        `/api/budgets/${mode.budget.id}`,
        "PATCH",
        { amountCents, effectiveMonth },
        "save",
      );
    else
      await mutate(
        "/api/budgets",
        "POST",
        { scope, categoryId, amountCents, effectiveMonth },
        "save",
      );
  }
  async function archive(budget: BudgetProgress) {
    await mutate(
      `/api/budgets/${budget.id}`,
      "PATCH",
      { archived: true, effectiveMonth: month },
      `archive:${budget.id}`,
    );
  }
  return (
    <section data-testid="budget-workbench" className="min-w-0 overflow-hidden">
      <header className="border-line grid gap-5 border-b pb-7 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="font-utility text-brand text-xs font-semibold tracking-[.16em] uppercase">
            Monthly allocation ledger / CAD
          </p>
          <h1 className="font-display mt-3 max-w-3xl text-5xl leading-[.92] font-semibold tracking-[-.055em] sm:text-6xl">
            Set the line. Watch the month answer.
          </h1>
          <p className="text-muted mt-4 max-w-2xl text-sm leading-6">
            Targets recur without rewriting history. Each month stands alone;
            unused room never rolls forward.
          </p>
        </div>
        <div
          className="border-line bg-panel flex rounded-full border p-1"
          aria-label="Budget privacy scope"
        >
          {(["family", "personal"] as const).map((value) => (
            <PendingButton
              key={value}
              data-testid={`budget-scope-${value}`}
              aria-pressed={scope === value}
              disabled={loading}
              pending={pending && pendingAction === `view:${value}:${month}`}
              pendingLabel="Updating…"
              onClick={() => changeView(value, month)}
              className={`focus-visible:outline-brand rounded-full px-5 py-2 text-sm font-semibold capitalize focus-visible:outline-2 focus-visible:outline-offset-2 ${scope === value ? "bg-brand text-surface" : "text-muted"}`}
            >
              {value}
            </PendingButton>
          ))}
        </div>
      </header>
      <div className="border-line bg-surface mt-6 flex flex-wrap items-center gap-3 rounded-2xl border p-3 sm:p-4">
        <PendingButton
          data-testid="budget-previous-month"
          aria-label="Previous month"
          onClick={() => changeView(scope, moveMonth(month, -1))}
          disabled={loading}
          pending={
            pendingAction === `view:${scope}:${moveMonth(month, -1)}` && pending
          }
          pendingLabel="Updating…"
          className="border-line focus-visible:outline-brand min-h-11 rounded-full border px-4 focus-visible:outline-2"
        >
          &larr; Previous
        </PendingButton>
        <p
          data-testid="budget-month"
          className="font-display order-first w-full flex-1 text-center text-2xl font-semibold sm:order-none sm:w-auto"
        >
          {monthLabel(month)}
        </p>
        <PendingButton
          data-testid="budget-next-month"
          aria-label="Next month"
          onClick={() => changeView(scope, moveMonth(month, 1))}
          disabled={loading}
          pending={
            pendingAction === `view:${scope}:${moveMonth(month, 1)}` && pending
          }
          pendingLabel="Updating…"
          className="border-line focus-visible:outline-brand min-h-11 rounded-full border px-4 focus-visible:outline-2"
        >
          Next &rarr;
        </PendingButton>
      </div>
      <div
        data-testid="budget-loading"
        className="text-mineral min-h-7 py-2 text-sm"
      >
        {loading ? "Updating the monthly ledger..." : ""}
      </div>
      {error && (
        <div
          data-testid="budget-error"
          role="alert"
          className="border-alert text-alert mb-4 rounded-xl border p-4"
        >
          {error}
        </div>
      )}
      <section
        aria-label="Budget summary"
        className="border-line bg-line grid gap-px overflow-hidden rounded-2xl border sm:grid-cols-3"
      >
        {[
          ["Target", model.summary.targetCents, "budget-summary-target"],
          ["Spent", model.summary.spentCents, "budget-summary-spent"],
          [
            "Remaining",
            model.summary.remainingCents,
            "budget-summary-remaining",
          ],
        ].map(([label, value, id]) => (
          <article key={String(id)} className="bg-surface p-5">
            <p className="font-utility text-muted text-[.65rem] tracking-[.14em] uppercase">
              {label}
            </p>
            <p
              data-testid={String(id)}
              className="font-display mt-7 text-3xl font-semibold tabular-nums"
            >
              {cad(Number(value))}
            </p>
          </article>
        ))}
      </section>
      <div className="mt-7 flex items-center justify-between gap-4">
        <div>
          <p className="font-utility text-muted text-[.65rem] tracking-[.14em] uppercase">
            {scope} register
          </p>
          <h2 className="font-display mt-1 text-3xl font-semibold">
            Category targets
          </h2>
        </div>
        <button
          data-testid="budget-create"
          disabled={loading || model.availableCategories.length === 0}
          onClick={openCreate}
          className="bg-brand text-surface focus-visible:outline-ink min-h-11 rounded-full px-5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-45"
        >
          + Set target
        </button>
      </div>
      {mode && (
        <form
          data-testid="budget-form"
          onSubmit={save}
          className="border-brand bg-panel mt-5 grid gap-4 rounded-2xl border p-5 md:grid-cols-[1.2fr_.8fr_.9fr_auto] md:items-end"
        >
          <label className="text-sm font-semibold">
            Category
            <select
              data-testid="budget-category"
              value={categoryId}
              disabled={mode.kind === "edit"}
              onChange={(e) => setCategoryId(e.target.value)}
              className="border-line bg-surface focus-visible:outline-brand mt-2 block min-h-11 w-full rounded-lg border px-3 focus-visible:outline-2"
            >
              {mode.kind === "edit" ? (
                <option value={mode.budget.categoryId}>
                  {mode.budget.categoryName}
                </option>
              ) : (
                model.availableCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="text-sm font-semibold">
            Target (CAD)
            <input
              data-testid="budget-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
              className="border-line bg-surface focus-visible:outline-brand mt-2 block min-h-11 w-full rounded-lg border px-3 tabular-nums focus-visible:outline-2"
            />
          </label>
          <label className="text-sm font-semibold">
            Effective month
            <input
              data-testid="budget-effective-month"
              type="date"
              value={effectiveMonth}
              onChange={(e) =>
                setEffectiveMonth(e.target.value.slice(0, 8) + "01")
              }
              required
              className="border-line bg-surface focus-visible:outline-brand mt-2 block min-h-11 w-full rounded-lg border px-3 focus-visible:outline-2"
            />
          </label>
          <div className="flex gap-2">
            <PendingButton
              data-testid="budget-save"
              disabled={loading || !categoryId}
              pending={pending && pendingAction === "save"}
              pendingLabel="Saving…"
              className="bg-brand text-surface min-h-11 rounded-full px-5 font-semibold"
            >
              Save
            </PendingButton>
            <button
              data-testid="budget-cancel"
              type="button"
              onClick={() => setMode(null)}
              className="border-line min-h-11 rounded-full border px-4"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      <div
        data-testid="budget-target-list"
        className="border-line bg-surface mt-5 overflow-hidden rounded-2xl border"
      >
        {model.budgets.length === 0 ? (
          <p className="text-muted p-7 text-sm">
            No targets apply in this month. The ledger is ready for its first
            line.
          </p>
        ) : (
          model.budgets.map((budget) => (
            <BudgetLine
              key={budget.id}
              budget={budget}
              disabled={loading}
              pending={pending}
              pendingAction={pendingAction}
              onEdit={() => openEdit(budget)}
              onArchive={() => archive(budget)}
            />
          ))
        )}
      </div>
      <p className="text-muted mt-4 text-xs leading-5">
        Family targets are collaborative for active members. Personal targets
        and progress are visible only to you.
      </p>
    </section>
  );
}
function BudgetLine({
  budget,
  disabled,
  pending,
  pendingAction,
  onEdit,
  onArchive,
}: {
  budget: BudgetProgress;
  disabled: boolean;
  pending: boolean;
  pendingAction: string;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const status = statusCopy[budget.status];
  const width = Math.min(Math.max(budget.percentageUsed, 0), 100);
  return (
    <article className="border-line grid min-w-0 gap-5 border-t p-5 first:border-t-0 lg:grid-cols-[minmax(10rem,1fr)_minmax(16rem,1.5fr)_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <i
            aria-hidden
            className="h-3 w-3 shrink-0 rounded-sm border"
            style={{ background: budget.categoryColor ?? "var(--mineral)" }}
          />
          <h3 className="truncate font-semibold">{budget.categoryName}</h3>
        </div>
        <p className="text-muted mt-1 text-xs">
          Target {cad(budget.amountCents)} / from {budget.effectiveMonth}
        </p>
      </div>
      <div
        data-testid={`budget-progress-${budget.id}`}
        role="meter"
        aria-label={`${budget.categoryName} budget used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(
          100,
          Math.max(0, Math.round(budget.percentageUsed)),
        )}
        className="min-w-0"
      >
        <div className="border-line bg-panel h-2 overflow-hidden rounded-full border">
          <span
            className={`block h-full transition-[width] duration-500 ${budget.status === "over" ? "bg-alert" : budget.status === "on-track" ? "bg-brand" : "bg-mineral"}`}
            style={{ width: `${width}%` }}
          />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
          <span>
            Spent <strong>{cad(budget.spentCents)}</strong>
          </span>
          <span>
            Remaining <strong>{cad(budget.remainingCents)}</strong>
          </span>
          <span>
            <strong>{budget.percentageUsed.toFixed(1)}%</strong> used
          </span>
          <span>
            {budget.overBudgetCents > 0 ? (
              <>
                Over{" "}
                <strong className="text-alert">
                  {cad(budget.overBudgetCents)}
                </strong>
              </>
            ) : (
              "No overage"
            )}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        <span
          data-testid={`budget-status-${budget.id}`}
          className="border-line bg-panel inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold"
        >
          <b aria-hidden>{status.icon}</b>
          {status.label}
        </span>
        <button
          data-testid={`budget-edit-${budget.id}`}
          onClick={onEdit}
          disabled={disabled}
          className="focus-visible:outline-brand min-h-9 rounded-full px-3 text-xs font-semibold underline-offset-4 hover:underline focus-visible:outline-2"
        >
          Edit
        </button>
        <PendingButton
          data-testid={`budget-archive-${budget.id}`}
          onClick={onArchive}
          disabled={disabled}
          pending={pending && pendingAction === `archive:${budget.id}`}
          pendingLabel="Archiving…"
          className="text-alert focus-visible:outline-alert min-h-9 rounded-full px-3 text-xs font-semibold focus-visible:outline-2"
        >
          Archive
        </PendingButton>
      </div>
    </article>
  );
}
