"use client";
import { useState } from "react";
import type { Category, TransactionCategoryView } from "@/lib/categories/types";
export type TransactionLedgerProps = {
  initialTransactions: TransactionCategoryView[];
  categories: Category[];
};
export function TransactionLedger({
  initialTransactions,
  categories,
}: TransactionLedgerProps) {
  const [rows, setRows] = useState(initialTransactions);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [rule, setRule] = useState<{
    id: string;
    categoryId: string;
    scope: "family" | "personal";
    count: number;
  } | null>(null);
  const [status, setStatus] = useState("");
  async function save(id: string) {
    const categoryId = chosen[id];
    if (!categoryId) return;
    const response = await fetch(`/api/transactions/${id}/category`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ categoryId }),
    });
    const body = await response.json();
    if (response.ok) {
      setRows((r) => r.map((x) => (x.id === id ? body.transaction : x)));
      setStatus(
        "One-off category saved. Plaid source details remain unchanged.",
      );
    } else
      setStatus(
        typeof body.error === "string" ? body.error : "Category update failed.",
      );
  }
  async function preview(id: string) {
    const categoryId = chosen[id];
    const category = categories.find((c) => c.id === categoryId);
    if (!category) {
      setStatus("Choose a category before creating a rule.");
      return;
    }
    const response = await fetch("/api/merchant-rules/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transactionId: id,
        categoryId: category.id,
        scope: category.scope,
      }),
    });
    const body = await response.json();
    if (response.ok)
      setRule({
        id,
        categoryId: category.id,
        scope: category.scope,
        count: body.matchCount,
      });
    else
      setStatus(
        typeof body.error === "string" ? body.error : "Rule preview failed.",
      );
  }
  async function confirm() {
    if (!rule) return;
    const response = await fetch("/api/merchant-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transactionId: rule.id,
        categoryId: rule.categoryId,
        scope: rule.scope,
        applyExisting: true,
      }),
    });
    const body = await response.json();
    if (response.ok) {
      setStatus(
        `Rule created and applied to ${body.updatedCount} transaction${body.updatedCount === 1 ? "" : "s"}.`,
      );
      setRule(null);
    } else
      setStatus(
        typeof body.error === "string" ? body.error : "Rule creation failed.",
      );
  }
  return (
    <section data-testid="transaction-ledger">
      <div className="border-line grid gap-4 overflow-hidden rounded-2xl border md:block md:gap-0">
        <div className="font-utility text-muted bg-panel hidden grid-cols-[minmax(12rem,1.5fr)_1fr_1fr_minmax(14rem,1.2fr)] gap-4 px-5 py-3 text-[.65rem] uppercase md:grid">
          <span>Transaction</span>
          <span>Plaid source</span>
          <span>Effective</span>
          <span>Classification</span>
        </div>
        {rows.map((row) => (
          <TransactionRow
            key={row.id}
            row={row}
            categories={categories}
            value={chosen[row.id] ?? row.effectiveCategory?.id ?? ""}
            setValue={(v) => setChosen((c) => ({ ...c, [row.id]: v }))}
            save={save}
            preview={preview}
          />
        ))}
      </div>
      {rule && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="rule-title"
          className="border-brand bg-surface mt-6 rounded-2xl border-2 p-5"
        >
          <h2 id="rule-title" className="font-display text-2xl font-semibold">
            Confirm merchant rule
          </h2>
          <p className="text-muted mt-2">
            This {rule.scope} rule will affect{" "}
            <strong data-testid="rule-preview-count" className="text-ink">
              {rule.count}
            </strong>{" "}
            eligible existing transactions. Manual choices are excluded.
          </p>
          <div className="mt-4 flex gap-3">
            <button
              data-testid="rule-confirm"
              onClick={() => void confirm()}
              className="bg-brand text-surface rounded-full px-5 py-2 font-bold"
            >
              Create and apply
            </button>
            <button
              onClick={() => setRule(null)}
              className="border-line rounded-full border px-5 py-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <p
        aria-live="polite"
        aria-atomic="true"
        className="text-brand mt-4 min-h-6"
      >
        {status}
      </p>
    </section>
  );
}
function TransactionRow({
  row,
  categories,
  value,
  setValue,
  save,
  preview,
}: {
  row: TransactionCategoryView;
  categories: Category[];
  value: string;
  setValue: (v: string) => void;
  save: (id: string) => Promise<void>;
  preview: (id: string) => Promise<void>;
}) {
  return (
    <article
      data-testid={`transaction-row-${row.id}`}
      className="border-line bg-surface grid gap-4 border-b p-5 last:border-b-0 md:grid-cols-[minmax(12rem,1.5fr)_1fr_1fr_minmax(14rem,1.2fr)] md:items-center"
    >
      <div>
        <h2 className="font-display text-lg font-semibold">
          {row.merchantName ?? row.name}
        </h2>
        <p className="text-muted mt-1 text-xs">
          {row.transactionDate} · ${Math.abs(row.amount).toFixed(2)}
          {row.pending ? " · Pending" : ""}
        </p>
      </div>
      <div data-testid={`original-category-${row.id}`}>
        <span className="font-utility text-muted text-[.6rem] uppercase md:hidden">
          Plaid source ·{" "}
        </span>
        {row.originalPlaidCategory?.detailed?.replaceAll("_", " ") ??
          "Uncategorized"}
      </div>
      <div data-testid={`effective-category-${row.id}`}>
        <span className="font-utility text-muted text-[.6rem] uppercase md:hidden">
          Effective ·{" "}
        </span>
        {row.effectiveCategory?.name ?? "Uncategorized"}
        <small className="text-muted block capitalize">
          {row.effectiveCategory?.source ?? "No source"}
        </small>
      </div>
      <div>
        <select
          aria-label={`Category for ${row.merchantName ?? row.name}`}
          data-testid={`category-select-${row.id}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="border-line min-h-11 w-full rounded-lg border bg-transparent px-3"
        >
          <option value="">Choose category</option>
          {categories
            .filter(
              (c) =>
                !c.archivedAt &&
                c.scope === row.scope &&
                (row.scope === "family" ||
                  c.ownerProfileId === row.ownerProfileId),
            )
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.scope}
              </option>
            ))}
        </select>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            data-testid={`category-save-${row.id}`}
            onClick={() => void save(row.id)}
            className="bg-brand text-surface rounded-full px-4 py-2 text-sm font-bold"
          >
            Save once
          </button>
          <button
            data-testid={`rule-create-${row.id}`}
            onClick={() => void preview(row.id)}
            className="border-brand text-brand rounded-full border px-4 py-2 text-sm font-bold"
          >
            Make rule
          </button>
        </div>
      </div>
    </article>
  );
}
