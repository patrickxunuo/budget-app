import Link from "next/link";
import type { Scope } from "@/lib/manual-entries/types";

export function TransactionManagementMenu({
  scope,
  returnTo,
}: {
  scope: Scope;
  returnTo: string;
}) {
  const query = new URLSearchParams({ scope, returnTo }).toString();
  const linkClassName =
    "focus-visible:outline-focus hover:bg-panel hover:text-ink block rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2";

  return (
    <details
      data-testid="transactions-manage-menu"
      className="group border-line text-muted relative rounded-full border"
    >
      <summary className="focus-visible:outline-focus hover:text-ink font-utility flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full px-4 text-[.65rem] font-bold tracking-[.14em] uppercase transition-colors marker:content-none focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
        Manage
        <span
          aria-hidden="true"
          className="text-brand text-xs transition-transform group-open:rotate-45"
        >
          +
        </span>
      </summary>
      <div className="border-line bg-surface absolute top-[calc(100%+.5rem)] right-0 z-20 min-w-56 rounded-2xl border p-2 shadow-[0_18px_55px_rgba(30,46,39,.12)]">
        <p className="font-utility text-muted px-3 pt-2 pb-1 text-[.58rem] font-bold tracking-[.14em] uppercase">
          {scope} ledger
        </p>
        <Link
          data-testid="transactions-manage-manual"
          href={`/transactions/manual?${query}`}
          className={linkClassName}
        >
          Manual / Cash
        </Link>
        <Link
          data-testid="transactions-manage-plaid"
          href={`/transactions/plaid?${query}`}
          className={linkClassName}
        >
          Plaid categories
        </Link>
      </div>
    </details>
  );
}

export function TransactionManagementBackLink({ href }: { href: string }) {
  return (
    <Link
      data-testid="back-to-transactions"
      href={href}
      className="focus-visible:outline-focus text-muted hover:text-ink font-utility inline-flex min-h-11 items-center gap-2 rounded-full text-[.65rem] font-bold tracking-[.14em] uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <span aria-hidden="true">←</span>
      Back to Transactions
    </Link>
  );
}
