"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  TransactionDetail,
  TransactionDetailSource,
} from "@/lib/transactions/transaction-detail";

export type TransactionDetailSelection = {
  id: string;
  source: TransactionDetailSource;
  trigger: HTMLButtonElement;
};

export type TransactionDetailSheetProps = {
  selection: TransactionDetailSelection | null;
  onClose: () => void;
};

type DetailResponse = { transaction?: TransactionDetail; error?: string };
type DetailResult =
  | { key: string; status: "loaded"; detail: TransactionDetail }
  | { key: string; status: "error"; error: string }
  | null;
const money = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
});

export function TransactionDetailSheet({
  selection,
  onClose,
}: TransactionDetailSheetProps) {
  const [result, setResult] = useState<DetailResult>(null);
  const [attempt, setAttempt] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    const trigger = selection?.trigger;
    onClose();
    trigger?.focus();
  }, [onClose, selection]);

  const requestKey = selection
    ? `${selection.source}:${selection.id}:${attempt}`
    : "";
  const currentResult = result?.key === requestKey ? result : null;
  const loading = Boolean(selection) && currentResult === null;
  const detail =
    currentResult?.status === "loaded" ? currentResult.detail : null;
  const error = currentResult?.status === "error" ? currentResult.error : "";

  useEffect(() => {
    if (!selection) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/api/transactions/detail/${selection.source}/${selection.id}`,
          {
            headers: { accept: "application/json" },
            signal: controller.signal,
          },
        );
        const body = (await response.json()) as DetailResponse;
        if (!response.ok || !body.transaction) {
          throw new Error(
            typeof body.error === "string"
              ? body.error
              : "Transaction details could not be loaded.",
          );
        }
        if (!controller.signal.aborted) {
          setResult({
            key: requestKey,
            status: "loaded",
            detail: body.transaction,
          });
        }
      } catch (reason) {
        if (controller.signal.aborted) return;
        setResult({
          key: requestKey,
          status: "error",
          error:
            reason instanceof Error
              ? reason.message
              : "Transaction details could not be loaded.",
        });
      }
    })();
    return () => controller.abort();
  }, [requestKey, selection]);

  useEffect(() => {
    if (!selection) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => closeRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, selection]);

  if (!selection || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/35 p-0 backdrop-blur-[2px] md:items-center md:p-6"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-detail-title"
        data-testid="transaction-detail-sheet"
        tabIndex={-1}
        className="border-line bg-surface text-ink max-h-[88dvh] w-full overflow-y-auto rounded-t-[1.75rem] border shadow-[0_-24px_70px_color-mix(in_srgb,var(--ink)_22%,transparent)] md:max-w-xl md:rounded-2xl md:shadow-[0_24px_80px_color-mix(in_srgb,var(--ink)_22%,transparent)]"
      >
        <div className="border-line-soft sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-[color:var(--surface)] px-5 py-4">
          <div className="min-w-0">
            <p className="font-utility text-brand text-[.58rem] font-semibold tracking-[.16em] uppercase">
              Read-only ledger record
            </p>
            <h2
              id="transaction-detail-title"
              className="font-display mt-1 truncate text-2xl font-semibold tracking-[-.025em]"
            >
              {detail?.merchantOrDescription ?? "Transaction details"}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            data-testid="transaction-detail-close"
            aria-label="Close transaction details"
            onClick={close}
            className="border-line focus-visible:outline-focus hover:bg-panel flex size-11 shrink-0 items-center justify-center rounded-full border text-xl focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="px-5 py-5 md:px-6">
          {loading && (
            <div
              data-testid="transaction-detail-loading"
              role="status"
              aria-label="Loading transaction details"
              className="grid gap-3"
            >
              {["w-2/3", "w-full", "w-5/6", "w-full", "w-3/4"].map(
                (width, index) => (
                  <span
                    key={index}
                    aria-hidden="true"
                    className={`bg-panel block h-11 animate-pulse rounded-xl ${width}`}
                  />
                ),
              )}
            </div>
          )}

          {!loading && error && (
            <div
              data-testid="transaction-detail-error"
              role="alert"
              className="border-alert bg-alert/5 rounded-xl border p-4"
            >
              <p className="text-alert text-sm leading-6">{error}</p>
              <button
                type="button"
                data-testid="transaction-detail-retry"
                onClick={() => setAttempt((value) => value + 1)}
                className="border-alert text-alert focus-visible:outline-focus mt-3 inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Retry
              </button>
            </div>
          )}

          {!loading && detail && <DetailMetadata detail={detail} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function DetailMetadata({ detail }: { detail: TransactionDetail }) {
  const entries: Array<[string, React.ReactNode]> = [
    ["Amount", money.format(detail.amountCents / 100)],
    ["Date", detail.date],
    ["Description", detail.description ?? "Not provided"],
    ["Account", detail.accountName ?? "Off-bank manual entry"],
    ["Privacy", `${detail.scope[0]!.toUpperCase()}${detail.scope.slice(1)}`],
    ["Status", `${detail.state[0]!.toUpperCase()}${detail.state.slice(1)}`],
    ["Type", `${detail.kind[0]!.toUpperCase()}${detail.kind.slice(1)}`],
    ["Source", detail.source === "plaid" ? "Connected account" : "Manual"],
    [
      "Original category",
      detail.originalCategory
        ? `${detail.originalCategory.primary} / ${detail.originalCategory.detailed}`
        : "Not provided",
    ],
    ["Effective category", detail.effectiveCategory ?? "Uncategorized"],
    ["Inclusion", detail.excluded ? "Excluded" : "Included"],
    ["Notes", detail.notes ?? "No notes"],
  ];

  return (
    <dl
      data-testid="transaction-detail-metadata"
      className="border-line-soft divide-line-soft divide-y overflow-hidden rounded-xl border"
    >
      {entries.map(([term, value]) => (
        <div
          key={term}
          className="grid grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] gap-4 px-4 py-3"
        >
          <dt className="font-utility text-muted text-[.58rem] font-semibold tracking-[.12em] uppercase">
            {term}
          </dt>
          <dd className="min-w-0 text-right text-sm leading-5 break-words tabular-nums">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
