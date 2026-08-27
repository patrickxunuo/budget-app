"use client";

import type { DashboardTransaction } from "@/lib/dashboard/types";
import { formatLocalDate } from "@/lib/transactions/accounting";

export type TransactionFeedProps = {
  rows: readonly DashboardTransaction[];
  timeZone: string;
  onSelect: (row: DashboardTransaction, trigger: HTMLButtonElement) => void;
  emptyState?: React.ReactNode;
};

const money = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
});
const cad = (cents: number) => money.format(cents / 100);

function previousDate(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function dateHeading(date: string, timeZone: string) {
  const today = formatLocalDate(new Date(), timeZone);
  if (date === today) return "Today";
  if (date === previousDate(today)) return "Yesterday";
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function TransactionFeed({
  rows,
  timeZone,
  onSelect,
  emptyState,
}: TransactionFeedProps) {
  const groups = Array.from(
    rows
      .reduce((result, row) => {
        const group = result.get(row.date);
        if (group) group.push(row);
        else result.set(row.date, [row]);
        return result;
      }, new Map<string, DashboardTransaction[]>())
      .entries(),
    ([date, groupedRows]) => ({ date, rows: groupedRows }),
  );

  return (
    <div
      data-testid="transactions-result-list"
      aria-label="Filtered transactions"
      className="border-line bg-surface min-w-0 overflow-hidden rounded-2xl border"
    >
      {groups.map((group) => (
        <section
          key={group.date}
          aria-labelledby={`transaction-date-${group.date}`}
        >
          <h3
            id={`transaction-date-${group.date}`}
            data-testid={`transactions-date-group-${group.date}`}
            className="border-line-soft bg-panel font-utility text-muted border-b px-4 py-2 text-[.62rem] font-semibold tracking-[.14em] uppercase md:px-5"
          >
            {dateHeading(group.date, timeZone)}
          </h3>
          <div className="divide-line-soft divide-y">
            {group.rows.map((row) => (
              <button
                key={`${row.source}:${row.id}`}
                type="button"
                data-testid={`transactions-result-${row.id}`}
                onClick={(event) => onSelect(row, event.currentTarget)}
                className="focus-visible:outline-focus hover:bg-panel grid min-h-14 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-left transition-colors focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] md:px-5"
              >
                <span className="min-w-0">
                  <span className="flex min-w-0 items-start gap-1.5">
                    <span className="font-display min-w-0 flex-1 text-[.98rem] leading-tight font-semibold break-words md:text-base">
                      {row.merchantOrDescription}
                    </span>
                    <span className="flex shrink-0 gap-1">
                      {row.pending && <LedgerBadge>Pending</LedgerBadge>}
                      {row.excluded && <LedgerBadge>Excluded</LedgerBadge>}
                      {row.source === "manual" && (
                        <LedgerBadge>Manual</LedgerBadge>
                      )}
                    </span>
                  </span>
                  <span className="text-muted mt-1 block text-xs leading-4 break-words">
                    {row.accountName ?? "Off-bank"}
                    <span aria-hidden="true"> · </span>
                    {row.category?.name ?? "Uncategorized"}
                  </span>
                </span>
                <strong
                  className={`font-display text-base font-semibold whitespace-nowrap tabular-nums md:text-lg ${
                    row.amountCents > 0 ? "text-brand" : "text-ink"
                  }`}
                >
                  {cad(row.amountCents)}
                </strong>
              </button>
            ))}
          </div>
        </section>
      ))}
      {rows.length === 0 ? emptyState : null}
    </div>
  );
}

function LedgerBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="border-line bg-background font-utility text-muted rounded-full border px-1.5 py-0.5 text-[.52rem] font-semibold tracking-[.08em] uppercase">
      {children}
    </span>
  );
}
