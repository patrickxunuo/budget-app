"use client";

import { useMemo, useState } from "react";
import type { Category } from "@/lib/categories/types";
import type {
  ManualEntry,
  ManualEntryInput,
  ManualEntryKind,
  Scope,
} from "@/lib/manual-entries/types";

export type ManualEntryWorkbenchProps = {
  initialEntries: ManualEntry[];
  categories: Category[];
  viewScope?: Scope;
};
type FormState = ManualEntryInput;

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const blank = (scope: Scope = "personal"): FormState => ({
  scope,
  kind: "spending",
  amount: "",
  entryDate: today(),
  description: "",
  categoryId: "",
  notes: "",
});
const money = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
});

export function ManualEntryWorkbench({
  initialEntries,
  categories,
  viewScope,
}: ManualEntryWorkbenchProps) {
  const [entries, setEntries] = useState(initialEntries);
  const [form, setForm] = useState<FormState>(() =>
    blank(viewScope ?? "personal"),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const availableCategories = useMemo(
    () =>
      categories.filter(
        (category) => !category.archivedAt && category.scope === form.scope,
      ),
    [categories, form.scope],
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  function reset() {
    setEditingId(null);
    setForm(blank(viewScope ?? "personal"));
    setError("");
  }
  function beginEdit(entry: ManualEntry) {
    setEditingId(entry.id);
    setConfirmingId(null);
    setError("");
    setStatus("");
    setForm({
      scope: entry.scope,
      kind: entry.kind,
      amount: entry.amount,
      entryDate: entry.entryDate,
      description: entry.description,
      categoryId: entry.categoryId,
      notes: entry.notes,
    });
    document
      .querySelector<HTMLElement>('[data-testid="manual-entry-form"]')
      ?.focus();
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const endpoint = editingId
        ? `/api/manual-entries/${editingId}`
        : "/api/manual-entries";
      const payload = editingId
        ? {
            kind: form.kind,
            amount: form.amount,
            entryDate: form.entryDate,
            description: form.description,
            categoryId: form.categoryId,
            notes: form.notes,
          }
        : form;
      const response = await fetch(endpoint, {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "The entry could not be saved.");
      setEntries((current) =>
        editingId
          ? current.map((entry) =>
              entry.id === editingId ? body.entry : entry,
            )
          : viewScope === undefined || body.entry.scope === viewScope
            ? [body.entry, ...current]
            : current,
      );
      setStatus(
        editingId
          ? "Manual entry updated. Edit history has been retained."
          : "Manual/Cash entry added to the ledger.",
      );
      reset();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The entry could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove(entry: ManualEntry, confirmed: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/manual-entries/${entry.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          body.error?.message ?? "The entry could not be deleted.",
        );
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      setConfirmingId(null);
      setStatus(
        "Entry removed from the active ledger. Its audit history is retained.",
      );
      if (editingId === entry.id) reset();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The entry could not be deleted.",
      );
    } finally {
      setBusy(false);
    }
  }
  function requestDelete(entry: ManualEntry) {
    if (entry.scope === "family") setConfirmingId(entry.id);
    else void remove(entry, false);
  }

  return (
    <section
      data-testid="manual-entry-workbench"
      className="grid gap-8 xl:grid-cols-[minmax(19rem,24rem)_minmax(0,1fr)] xl:items-start"
    >
      <div className="border-line bg-panel relative overflow-hidden rounded-[1.75rem] border p-5 shadow-[0_18px_55px_rgba(30,46,39,.07)] sm:p-6 xl:sticky xl:top-24">
        <div
          aria-hidden="true"
          className="bg-mineral/10 absolute -top-16 -right-10 size-40 rotate-12 rounded-[2.5rem]"
        />
        <p className="font-utility text-mineral relative text-[.65rem] font-bold tracking-[.18em] uppercase">
          Manual / cash desk
        </p>
        <h2 className="font-display relative mt-2 text-3xl leading-none font-semibold tracking-[-.035em]">
          {editingId ? "Revise the record." : "Set it down in ink."}
        </h2>
        <p className="text-muted relative mt-3 text-sm leading-6">
          Off-bank activity belongs in its own register, with privacy and
          authorship attached.
        </p>
        <form
          data-testid="manual-entry-form"
          tabIndex={-1}
          onSubmit={submit}
          className="relative mt-6 grid gap-4 outline-none"
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-semibold">
              Privacy
              <select
                data-testid="manual-entry-scope"
                value={form.scope}
                disabled={Boolean(editingId)}
                onChange={(event) => {
                  set("scope", event.target.value as Scope);
                  set("categoryId", "");
                }}
                className="border-line bg-surface mt-1.5 min-h-11 w-full rounded-xl border px-3 disabled:opacity-60"
              >
                <option value="personal">Personal</option>
                <option value="family">Family</option>
              </select>
            </label>
            <label className="text-sm font-semibold">
              Entry kind
              <select
                data-testid="manual-entry-kind"
                value={form.kind}
                onChange={(event) =>
                  set("kind", event.target.value as ManualEntryKind)
                }
                className="border-line bg-surface mt-1.5 min-h-11 w-full rounded-xl border px-3"
              >
                <option value="spending">Spending</option>
                <option value="income">Income</option>
                <option value="refund">Refund</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-[1fr_9.5rem] gap-3">
            <label className="text-sm font-semibold">
              Amount (CAD)
              <input
                data-testid="manual-entry-amount"
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(event) => set("amount", event.target.value)}
                inputMode="decimal"
                placeholder={form.kind === "spending" ? "-24.50" : "24.50"}
                required
                className="border-line bg-surface mt-1.5 min-h-11 w-full rounded-xl border px-3 font-mono"
              />
            </label>
            <label className="text-sm font-semibold">
              Date
              <input
                data-testid="manual-entry-date"
                type="date"
                value={form.entryDate}
                onChange={(event) => set("entryDate", event.target.value)}
                required
                className="border-line bg-surface mt-1.5 min-h-11 w-full rounded-xl border px-3"
              />
            </label>
          </div>
          <label className="text-sm font-semibold">
            Description
            <input
              data-testid="manual-entry-description"
              value={form.description}
              onChange={(event) => set("description", event.target.value)}
              required
              maxLength={160}
              className="border-line bg-surface mt-1.5 min-h-11 w-full rounded-xl border px-3"
            />
          </label>
          <label className="text-sm font-semibold">
            Category
            <select
              data-testid="manual-entry-category"
              value={form.categoryId}
              onChange={(event) => set("categoryId", event.target.value)}
              required
              className="border-line bg-surface mt-1.5 min-h-11 w-full rounded-xl border px-3"
            >
              <option value="">Choose a {form.scope} category</option>
              {availableCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold">
            Notes <span className="text-muted font-normal">optional</span>
            <textarea
              data-testid="manual-entry-notes"
              value={form.notes ?? ""}
              onChange={(event) => set("notes", event.target.value)}
              maxLength={1000}
              rows={3}
              className="border-line bg-surface mt-1.5 w-full resize-y rounded-xl border px-3 py-2"
            />
          </label>
          <p className="text-muted -mt-1 text-xs">
            Spending uses a minus sign. Income and refunds are positive.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              data-testid="manual-entry-submit"
              disabled={busy}
              className="bg-brand text-surface focus-visible:outline-mineral min-h-11 flex-1 rounded-full px-5 font-bold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
            >
              {busy
                ? "Recording…"
                : editingId
                  ? "Save revision"
                  : "Record entry"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={reset}
                className="border-line min-h-11 rounded-full border px-5 font-semibold"
              >
                Cancel
              </button>
            )}
          </div>
          <p
            data-testid="manual-entry-error"
            role="alert"
            className="text-alert min-h-5 text-sm"
          >
            {error}
          </p>
        </form>
      </div>

      <div>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-utility text-muted text-[.65rem] tracking-[.16em] uppercase">
              Independent register
            </p>
            <h2 className="font-display mt-1 text-3xl font-semibold">
              Manual/Cash entries
            </h2>
          </div>
          <a
            data-testid="manual-entry-export"
            href={`/api/manual-entries?scope=${viewScope ?? "personal"}&format=csv`}
            download
            className="border-brand text-brand focus-visible:outline-brand rounded-full border px-4 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Export CSV
          </a>
        </div>
        <p aria-live="polite" className="text-brand mb-3 min-h-5 text-sm">
          {status}
        </p>
        <div className="border-line divide-line divide-y overflow-hidden rounded-[1.5rem] border">
          {entries.map((entry) => (
            <article
              data-testid={`manual-entry-row-${entry.id}`}
              key={entry.id}
              className="bg-surface grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="bg-mineral/10 text-mineral font-utility rounded-full px-2 py-1 text-[.6rem] font-bold tracking-[.12em] uppercase">
                    Manual / Cash
                  </span>
                  <span className="text-muted font-utility text-[.62rem] uppercase">
                    {entry.scope} · {entry.kind}
                  </span>
                </div>
                <div className="mt-3 flex items-baseline justify-between gap-4">
                  <h3 className="font-display truncate text-xl font-semibold">
                    {entry.description}
                  </h3>
                  <strong
                    className={
                      entry.kind === "spending"
                        ? "text-alert font-mono"
                        : "text-brand font-mono"
                    }
                  >
                    {money.format(Number(entry.amount))}
                  </strong>
                </div>
                <p className="text-muted mt-1 text-sm">
                  {entry.entryDate} · {entry.categoryName ?? "Categorized"}
                  {entry.notes ? ` · ${entry.notes}` : ""}
                </p>
                {entry.scope === "family" && (
                  <p className="text-muted mt-2 text-xs">
                    Created by {shortId(entry.createdBy)} · Last edited by{" "}
                    {shortId(entry.lastEditedBy)}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 md:justify-end">
                {confirmingId === entry.id ? (
                  <>
                    <button
                      data-testid={`manual-entry-delete-confirm-${entry.id}`}
                      disabled={busy}
                      onClick={() => void remove(entry, true)}
                      className="bg-alert text-surface focus-visible:outline-alert rounded-full px-4 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      Confirm removal
                    </button>
                    <button
                      data-testid={`manual-entry-delete-cancel-${entry.id}`}
                      onClick={() => setConfirmingId(null)}
                      className="border-line rounded-full border px-4 py-2 text-sm font-semibold"
                    >
                      Keep entry
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      data-testid={`manual-entry-edit-${entry.id}`}
                      onClick={() => beginEdit(entry)}
                      className="border-brand text-brand focus-visible:outline-brand rounded-full border px-4 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      Edit
                    </button>
                    <button
                      data-testid={`manual-entry-delete-${entry.id}`}
                      onClick={() => requestDelete(entry)}
                      className="text-alert focus-visible:outline-alert rounded-full px-4 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
          {entries.length === 0 && (
            <div className="bg-panel px-6 py-14 text-center">
              <p className="font-display text-2xl font-semibold">
                A clean sheet.
              </p>
              <p className="text-muted mt-2 text-sm">
                Cash purchases, income, and refunds will gather here.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
function shortId(value: string) {
  return `${value.slice(0, 8)}…`;
}
