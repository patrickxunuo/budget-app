import type { Metadata } from "next";

import { PlaidLinkFlow } from "@/components/plaid/plaid-link-flow";
import { requireActiveMembership } from "@/lib/auth/dal";

export const metadata: Metadata = {
  title: "Accounts",
  description: "Connect and classify read-only Canadian bank accounts.",
};

export default async function AccountsPage() {
  await requireActiveMembership();

  return (
    <main className="px-5 py-9 sm:px-8 sm:py-11 lg:px-12 lg:py-14">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 grid gap-5 lg:grid-cols-[1fr_22rem] lg:items-end">
          <div>
            <p className="font-utility text-brand text-[.68rem] font-semibold tracking-[.15em] uppercase">
              Accounts / secure intake
            </p>
            <h1 className="font-display text-ink mt-3 max-w-3xl text-5xl leading-[.94] font-semibold tracking-[-.06em] sm:text-6xl">
              Open the connection dossier.
            </h1>
          </div>
          <p className="border-line text-muted border-l pl-5 text-sm leading-6">
            Plaid brings back account metadata and read-only transactions. You
            decide which records stay Personal and which join the Family ledger.
          </p>
        </header>
        <PlaidLinkFlow />
      </div>
    </main>
  );
}
