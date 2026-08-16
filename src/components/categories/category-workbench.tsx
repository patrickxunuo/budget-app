"use client";
import { useState } from "react";
import { PendingButton } from "@/components/pending-button";
import { Select } from "@/components/select";
import { usePendingAction } from "@/hooks/use-pending-action";
import type { Category, MerchantRule } from "@/lib/categories/types";
export type CategoryWorkbenchProps = {
  initialCategories: Category[];
  initialRules: MerchantRule[];
};
export function CategoryWorkbench({
  initialCategories,
  initialRules,
}: CategoryWorkbenchProps) {
  const [categories, setCategories] = useState(initialCategories);
  const [status, setStatus] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const { pending, run } = usePendingAction();
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await run(async () => {
      setPendingAction("create");
      try {
        const response = await fetch("/api/categories", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: form.get("name"),
            color: form.get("color"),
            scope: form.get("scope"),
          }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        setCategories((c) => [...c, body.category]);
        e.currentTarget.reset();
        setStatus(
          `${body.category.name} added to ${body.category.scope} categories.`,
        );
      } catch (error) {
        setStatus(
          error instanceof Error
            ? error.message
            : "Category could not be saved.",
        );
      }
    });
  }
  async function archive(category: Category) {
    await run(async () => {
      setPendingAction(`archive:${category.id}`);
      try {
        const response = await fetch(`/api/categories/${category.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ archived: true }),
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            typeof body.error === "string" ? body.error : "Archive failed.",
          );
        setCategories((c) =>
          c.map((x) => (x.id === category.id ? body.category : x)),
        );
        setStatus(`${category.name} archived. Historical labels are retained.`);
      } catch (error) {
        setStatus(
          error instanceof Error
            ? error.message
            : "Category could not be archived.",
        );
      }
    });
  }
  return (
    <section
      data-testid="category-workbench"
      className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_23rem]"
    >
      <div className="space-y-7">
        <form
          onSubmit={create}
          className="border-line bg-panel grid gap-4 rounded-[1.5rem] border p-5 sm:grid-cols-[1fr_8rem_9rem_auto] sm:items-end"
        >
          <label className="text-sm font-semibold">
            Category name
            <input
              data-testid="category-name"
              name="name"
              disabled={pending}
              required
              maxLength={80}
              className="border-line bg-surface mt-2 min-h-11 w-full rounded-lg border px-3 font-normal"
            />
          </label>
          <label className="text-sm font-semibold">
            Ink
            <input
              data-testid="category-color"
              name="color"
              type="color"
              disabled={pending}
              defaultValue="#176044"
              className="border-line bg-surface mt-2 h-11 w-full rounded-lg border p-1"
            />
          </label>
          <label className="text-sm font-semibold">
            Privacy
            <Select
              data-testid="category-scope"
              name="scope"
              defaultValue="family"
              disabled={pending}
              options={[
                { value: "family", label: "Family" },
                { value: "personal", label: "Personal" },
              ]}
              className="mt-2"
            />
          </label>
          <PendingButton
            data-testid="category-submit"
            disabled={pending}
            pending={pending && pendingAction === "create"}
            pendingLabel="Saving…"
            className="bg-brand text-surface min-h-11 rounded-full px-5 font-bold"
          >
            Add category
          </PendingButton>
        </form>
        {(["family", "personal"] as const).map((scope) => (
          <section key={scope} aria-labelledby={`${scope}-title`}>
            <div className="mb-3 flex items-baseline justify-between">
              <h2
                id={`${scope}-title`}
                className="font-display text-2xl font-semibold capitalize"
              >
                {scope} register
              </h2>
              <span className="font-utility text-muted text-xs uppercase">
                {scope === "family"
                  ? "Visible to household"
                  : "Only visible to you"}
              </span>
            </div>
            <div className="border-line divide-line divide-y overflow-hidden rounded-2xl border">
              {categories
                .filter((c) => c.scope === scope)
                .map((c) => (
                  <article
                    key={c.id}
                    className={`bg-surface flex items-center gap-4 p-4 ${c.archivedAt ? "opacity-60" : ""}`}
                  >
                    <span
                      className="size-3 rounded-full"
                      style={{ background: c.color ?? "var(--muted)" }}
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold">{c.name}</h3>
                      <p className="text-muted text-xs">
                        <span className="font-utility uppercase">
                          {c.scope === "family"
                            ? "Family · shared"
                            : "Personal · only you"}
                        </span>
                        {" · "}
                        {c.archivedAt
                          ? "Archived · historical labels retained"
                          : c.systemKey
                            ? "Plaid standard · always available"
                            : c.inUse
                              ? "In use · labels retained on archive"
                              : "Custom category"}
                      </p>
                    </div>
                    {!c.systemKey && !c.archivedAt && (
                      <PendingButton
                        disabled={pending}
                        pending={pending && pendingAction === `archive:${c.id}`}
                        pendingLabel="Archiving…"
                        onClick={() => void archive(c)}
                        className="text-alert focus-visible:outline-brand rounded px-3 py-2 text-sm font-semibold"
                      >
                        Archive
                      </PendingButton>
                    )}
                  </article>
                ))}
            </div>
          </section>
        ))}
      </div>
      <aside>
        <p className="font-utility text-brand text-xs font-semibold uppercase">
          Merchant rules
        </p>
        <h2 className="font-display mt-2 text-3xl font-semibold">
          Automation register
        </h2>
        <p className="text-muted mt-2 text-sm leading-6">
          Rules preserve one-off manual choices and only operate inside their
          privacy scope.
        </p>
        <ol className="border-line mt-5 divide-y rounded-2xl border">
          {initialRules.map((rule) => (
            <li key={rule.id} className="p-4 text-sm">
              <strong>{rule.matchValue}</strong>
              <span className="text-muted mt-1 block capitalize">
                {rule.scope} · {rule.enabled ? "Active" : "Paused"}
              </span>
            </li>
          ))}
          {initialRules.length === 0 && (
            <li className="text-muted p-4 text-sm">
              Create a rule from a transaction.
            </li>
          )}
        </ol>
      </aside>
      <p aria-live="polite" className="text-brand min-h-6 xl:col-span-2">
        {status}
      </p>
    </section>
  );
}
