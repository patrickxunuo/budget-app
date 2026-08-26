"use client";

import { useEffect, useState } from "react";

import type { SyncResult, SyncStatus } from "@/lib/plaid/types";

export type PlaidSyncStatusProps = {
  items: SyncStatus[];
  referenceTime?: string;
  timeZone?: string;
};

function freshnessLabel(
  value: string | null,
  referenceTime: string,
  timeZone: string,
) {
  if (!value) return "Waiting for the first update";
  const elapsed = Date.parse(referenceTime) - Date.parse(value);
  if (elapsed < 60_000) return "Updated just now";
  if (elapsed < 3_600_000)
    return `Updated ${Math.max(1, Math.floor(elapsed / 60_000))} min ago`;
  if (elapsed < 86_400_000)
    return `Updated ${Math.floor(elapsed / 3_600_000)} hr ago`;
  return `Updated ${new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(new Date(value))}`;
}

function consentSoon(value: string | null, referenceTime: string) {
  return (
    value !== null &&
    Date.parse(value) < Date.parse(referenceTime) + 14 * 86_400_000
  );
}

export function PlaidSyncStatus({
  items: initialItems,
  referenceTime,
  timeZone = "UTC",
}: PlaidSyncStatusProps) {
  const stableReferenceTime =
    referenceTime ??
    initialItems
      .flatMap((item) => [
        item.lastAttemptAt,
        item.lastSuccessAt,
        item.nextRetryAt,
        item.consentExpiresAt,
      ])
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ??
    "1970-01-01T00:00:00.000Z";
  const [items, setItems] = useState(initialItems);
  const [checking, setChecking] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});

  useEffect(() => {
    function handleSyncCompleted(event: Event) {
      const result = (event as CustomEvent<SyncResult>).detail;
      if (
        !result ||
        (result.status !== "succeeded" && result.status !== "idle")
      )
        return;

      setItems((current) =>
        current.map((item) =>
          item.itemId === result.itemId
            ? {
                ...item,
                status: result.status,
                lastSuccessAt: result.lastSuccessAt,
                errorCode: null,
                needsLoginRepair: false,
              }
            : item,
        ),
      );
      const changed = result.added + result.modified + result.removed;
      setFeedback((current) => ({
        ...current,
        [result.itemId]: changed
          ? `${changed} transaction update${changed === 1 ? "" : "s"} completed.`
          : "Everything is already current.",
      }));
    }

    window.addEventListener("plaid:sync-completed", handleSyncCompleted);
    return () =>
      window.removeEventListener("plaid:sync-completed", handleSyncCompleted);
  }, []);

  async function check(itemId: string) {
    setChecking(itemId);
    setFeedback((current) => ({
      ...current,
      [itemId]: "Checking for available updates...",
    }));
    try {
      const response = await fetch("/api/plaid/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      const body = (await response.json()) as SyncResult & { message?: string };
      if (!response.ok)
        throw new Error(body.message ?? "Updates are temporarily unavailable.");
      setItems((current) =>
        current.map((item) =>
          item.itemId === itemId
            ? {
                ...item,
                status: body.status,
                lastSuccessAt: body.lastSuccessAt,
                errorCode: null,
              }
            : item,
        ),
      );
      const changed = body.added + body.modified + body.removed;
      setFeedback((current) => ({
        ...current,
        [itemId]: changed
          ? `${changed} transaction update${changed === 1 ? "" : "s"} completed.`
          : "Everything is already current.",
      }));
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        [itemId]:
          error instanceof Error
            ? error.message
            : "Updates are temporarily unavailable.",
      }));
    } finally {
      setChecking(null);
    }
  }

  if (items.length === 0) return null;

  return (
    <section
      aria-labelledby="freshness-title"
      data-testid="plaid-sync-status"
      className="border-line bg-panel relative mb-8 overflow-hidden rounded-[1.75rem] border p-5 shadow-[0_16px_50px_rgba(48,38,27,.06)] sm:p-7"
    >
      <div
        aria-hidden="true"
        className="bg-brand/8 absolute -top-16 -right-12 size-44 rounded-full blur-3xl"
      />
      <div className="relative flex flex-col gap-2 border-b border-[var(--line)] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-utility text-brand text-[.62rem] font-semibold tracking-[.15em] uppercase">
            Ledger signal
          </p>
          <h2
            id="freshness-title"
            className="font-display text-ink mt-1 text-2xl font-semibold tracking-[-.035em]"
          >
            Data freshness
          </h2>
        </div>
        <p className="text-muted max-w-md text-sm leading-6">
          Updates arrive quietly from your institution. Check only for data
          Plaid has already made available.
        </p>
      </div>
      <div className="relative divide-y divide-[var(--line)]">
        {items.map((item) => {
          const busy = checking === item.itemId || item.status === "running";
          const repair = item.needsLoginRepair;
          const expiring = consentSoon(
            item.consentExpiresAt,
            stableReferenceTime,
          );
          return (
            <article
              key={item.itemId}
              className="grid gap-4 py-5 first:pt-5 last:pb-0 md:grid-cols-[1fr_auto] md:items-center"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-ink text-lg font-semibold">
                    {item.institutionName}
                  </h3>
                  <span
                    className={`font-utility rounded-full border px-2.5 py-1 text-[.58rem] font-semibold tracking-[.08em] uppercase ${repair ? "border-alert/30 bg-alert/5 text-alert" : "border-brand/25 bg-brand/5 text-brand"}`}
                  >
                    {repair ? "Action needed" : busy ? "Checking" : "Connected"}
                  </span>
                </div>
                <p className="text-muted mt-1 text-sm">
                  {freshnessLabel(
                    item.lastSuccessAt,
                    stableReferenceTime,
                    timeZone,
                  )}
                </p>
                {repair ? (
                  <p className="text-ink mt-2 text-sm leading-6">
                    Reconnect this institution using the connection dossier
                    below to resume updates.
                  </p>
                ) : null}
                {expiring ? (
                  <p className="text-ink mt-2 text-sm leading-6">
                    Consent expires soon. Reconnect at a convenient time to keep
                    the ledger current.
                  </p>
                ) : null}
                <p
                  data-testid="plaid-sync-feedback"
                  aria-live="polite"
                  aria-atomic="true"
                  className="text-muted mt-2 min-h-5 text-sm"
                >
                  {feedback[item.itemId] ?? ""}
                </p>
              </div>
              <button
                type="button"
                data-testid="plaid-sync-check"
                disabled={busy || repair}
                aria-busy={busy}
                onClick={() => void check(item.itemId)}
                className="border-brand text-brand hover:bg-brand hover:text-surface focus-visible:outline-brand inline-flex min-h-11 items-center justify-center rounded-full border-2 px-5 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none"
              >
                {busy ? "Checking..." : "Check for updates"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
