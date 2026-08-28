"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SearchableSelect, Select } from "@/components/select";
import type {
  ExplorerFilters,
  ExplorerInclusion,
  ExplorerStatus,
} from "@/lib/transactions/explorer-filters";

export type TransactionFilterSheetProps = {
  filters: ExplorerFilters;
  accounts: readonly { id: string; name: string }[];
  categories: readonly { id: string; name: string }[];
  unknownAccount: boolean;
  unknownCategory: boolean;
  draftFrom: string;
  draftTo: string;
  customRangeReady: boolean;
  onUpdate: (patch: Partial<ExplorerFilters>) => void;
  onDraftFrom: (value: string) => void;
  onDraftTo: (value: string) => void;
  onApplyCustomRange: () => void;
  onOpenChange?: (open: boolean) => void;
};

const field =
  "border-line bg-surface focus-visible:outline-focus min-h-11 w-full min-w-0 rounded-xl border px-3 font-sans text-base tracking-normal normal-case focus-visible:outline-2 focus-visible:outline-offset-2";
const fieldLabel =
  "font-utility text-muted grid gap-1.5 text-[.62rem] font-semibold tracking-[.14em] uppercase";
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

export function countAdvancedFilters(filters: ExplorerFilters) {
  return (
    Number(Boolean(filters.accountId)) +
    Number(Boolean(filters.categoryId)) +
    Number(filters.status !== "all") +
    Number(filters.inclusion !== "default") +
    Number(filters.period === "custom" && Boolean(filters.from && filters.to))
  );
}

export function TransactionFilterSheet(props: TransactionFilterSheetProps) {
  const { onOpenChange } = props;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef(false);
  const count = countAdvancedFilters(props.filters);

  const close = useCallback(() => {
    const trigger = triggerRef.current;
    openRef.current = false;
    setOpen(false);
    onOpenChange?.(false);
    trigger?.focus();
  }, [onOpenChange]);

  useEffect(
    () => () => {
      if (openRef.current) onOpenChange?.(false);
    },
    [onOpenChange],
  );
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      // Nested composites (such as SearchableSelect) own the first Escape.
      // React forwards preventDefault to the native event before it reaches
      // this document listener, so a handled key must not close the sheet.
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;

      const selector =
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const panel = panelRef.current;
      const panelFocusable = Array.from(
        panel?.querySelectorAll<HTMLElement>(selector) ?? [],
      );
      const selectPortals = Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-piggy-select-portal-for]",
        ),
      );
      // A portaled menu follows its owning trigger in the modal tab order.
      // This preserves a natural composite-control sequence while keeping every
      // Tab destination within the sheet's logical accessibility boundary.
      const focusable = panelFocusable.flatMap((element) => {
        const portalFocusable = selectPortals
          .filter(
            (portal) => portal.dataset.piggySelectPortalFor === element.id,
          )
          .flatMap((portal) =>
            Array.from(portal.querySelectorAll<HTMLElement>(selector)),
          );
        return [element, ...portalFocusable];
      });
      if (focusable.length === 0) {
        event.preventDefault();
        panel?.focus();
        return;
      }

      event.preventDefault();
      const current = focusable.indexOf(document.activeElement as HTMLElement);
      const direction = event.shiftKey ? -1 : 1;
      const next =
        current < 0
          ? event.shiftKey
            ? focusable.length - 1
            : 0
          : (current + direction + focusable.length) % focusable.length;
      focusable[next]?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="transactions-filters-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          openRef.current = true;
          setOpen(true);
          onOpenChange?.(true);
        }}
        className="border-line focus-visible:outline-focus flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 md:hidden"
      >
        Filters
        <span
          data-testid="transactions-filter-count"
          aria-label={`${count} active advanced filters`}
          className="bg-mineral text-on-accent flex size-6 items-center justify-center rounded-full text-xs tabular-nums"
        >
          {count}
        </span>
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[1050] flex items-end overflow-hidden bg-black/35 backdrop-blur-[2px]"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) close();
              }}
            >
              <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="transaction-filter-title"
                data-testid="transactions-filter-sheet"
                tabIndex={-1}
                className="border-line bg-surface flex max-h-[min(60dvh,28rem)] min-h-0 w-full flex-col overflow-hidden rounded-t-[1.5rem] border shadow-[0_-24px_70px_color-mix(in_srgb,var(--ink)_22%,transparent)]"
              >
                <div className="border-line-soft flex shrink-0 items-center justify-between gap-3 border-b px-3 py-2">
                  <h2
                    id="transaction-filter-title"
                    className="font-display text-xl font-semibold"
                  >
                    Filters
                  </h2>
                  <button
                    ref={closeRef}
                    type="button"
                    data-testid="transactions-filter-close"
                    aria-label="Close transaction filters"
                    onClick={close}
                    className="border-line focus-visible:outline-focus flex size-11 items-center justify-center rounded-full border text-xl focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
                <div
                  data-testid="transactions-filter-scroll-region"
                  className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-3 pt-2 pb-[max(.75rem,env(safe-area-inset-bottom))]"
                  style={{ WebkitOverflowScrolling: "touch" }}
                >
                  <div
                    data-testid="transactions-filter-grid"
                    className="grid grid-cols-2 gap-2"
                  >
                    <AdvancedFields {...props} />
                  </div>
                  {props.filters.period === "custom" && (
                    <div className="border-line bg-panel mt-3 grid grid-cols-2 gap-3 rounded-xl border p-3">
                      <label className={fieldLabel}>
                        From
                        <input
                          data-testid="transactions-custom-from"
                          type="date"
                          value={props.draftFrom}
                          onChange={(event) =>
                            props.onDraftFrom(event.target.value)
                          }
                          className={field}
                        />
                      </label>
                      <label className={fieldLabel}>
                        To
                        <input
                          data-testid="transactions-custom-to"
                          type="date"
                          value={props.draftTo}
                          onChange={(event) =>
                            props.onDraftTo(event.target.value)
                          }
                          className={field}
                        />
                      </label>
                      <button
                        type="button"
                        data-testid="transactions-custom-apply"
                        onClick={props.onApplyCustomRange}
                        disabled={!props.customRangeReady}
                        className="bg-brand text-on-accent focus-visible:outline-focus col-span-2 min-h-11 rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                      >
                        Apply range
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function AdvancedFields(props: TransactionFilterSheetProps) {
  return (
    <>
      <label className={fieldLabel}>
        Account
        <Select
          data-testid="transactions-account-filter"
          value={props.filters.accountId}
          onValueChange={(accountId) => props.onUpdate({ accountId })}
          options={[
            { value: "", label: "All accounts" },
            ...props.accounts.map((account) => ({
              value: account.id,
              label: account.name,
            })),
            ...(props.unknownAccount
              ? [
                  {
                    value: props.filters.accountId,
                    label: "Unavailable account",
                  },
                ]
              : []),
          ]}
          className={field}
          aria-label="Account filter"
        />
      </label>
      <label className={fieldLabel}>
        Category
        <SearchableSelect
          data-testid="transactions-category-filter"
          value={props.filters.categoryId}
          onValueChange={(categoryId) => props.onUpdate({ categoryId })}
          placeholder="All categories"
          searchPlaceholder="Search categories"
          emptyMessage="No categories match"
          options={[
            { value: "", label: "All categories" },
            ...props.categories.map((category) => ({
              value: category.id,
              label: category.name,
            })),
            ...(props.unknownCategory
              ? [
                  {
                    value: props.filters.categoryId,
                    label: "Unavailable category",
                  },
                ]
              : []),
          ]}
          className={field}
          aria-label="Category filter"
        />
      </label>
      <label className={fieldLabel}>
        Status
        <Select
          data-testid="transactions-status-filter"
          value={props.filters.status}
          onValueChange={(status) =>
            props.onUpdate({ status: status as ExplorerStatus })
          }
          options={STATUS_OPTIONS}
          className={field}
          aria-label="Status filter"
        />
      </label>
      <label className={fieldLabel}>
        Inclusion
        <Select
          data-testid="transactions-inclusion-filter"
          value={props.filters.inclusion}
          onValueChange={(inclusion) =>
            props.onUpdate({ inclusion: inclusion as ExplorerInclusion })
          }
          options={INCLUSION_OPTIONS}
          className={field}
          aria-label="Inclusion filter"
        />
      </label>
    </>
  );
}
