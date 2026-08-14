import type { Metadata } from "next";

import { PlaidConnectionManager } from "@/components/plaid/plaid-connection-manager";
import { PlaidLinkFlow } from "@/components/plaid/plaid-link-flow";
import { PlaidSyncStatus } from "@/components/plaid/plaid-sync-status";
import { requireActiveMembership } from "@/lib/auth/dal";
import { getPlaidConnections } from "@/lib/plaid/connection-management";
import { getPlaidSyncStatuses } from "@/lib/plaid/sync-service";

export const metadata: Metadata = {
  title: "Accounts",
  description:
    "Connect, inspect, and safely manage read-only Canadian bank accounts.",
};

export default async function AccountsPage() {
  const { user, membership } = await requireActiveMembership();
  const actor = {
    userId: user.id,
    workspaceId: membership.workspace_id,
    membershipId: membership.id,
  };
  const [syncStatuses, connections] = await Promise.all([
    getPlaidSyncStatuses(actor),
    getPlaidConnections(actor),
  ]);
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="px-5 py-9 sm:px-8 sm:py-11 lg:px-12 lg:py-14"
    >
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 grid gap-5 lg:grid-cols-[1fr_22rem] lg:items-end">
          <div>
            <p className="font-utility text-brand text-[.68rem] font-semibold tracking-[.15em] uppercase">
              Accounts / secure custody
            </p>
            <h1 className="font-display text-ink mt-3 max-w-3xl text-5xl leading-[.94] font-semibold tracking-[-.06em] sm:text-6xl">
              Open the connection dossier.
            </h1>
          </div>
          <p className="border-line text-muted border-l pl-5 text-sm leading-6">
            Plaid brings back account metadata and read-only transactions. You
            decide which records stay Personal, which join the Family ledger,
            and when a connection’s custody ends.
          </p>
        </header>
        <PlaidSyncStatus
          items={syncStatuses}
          referenceTime={new Date().toISOString()}
          timeZone="UTC"
        />
        <PlaidConnectionManager initialConnections={connections} />
        <div className="border-line mt-12 border-t pt-8">
          <p className="font-utility text-muted mb-4 text-xs font-bold tracking-[.16em] uppercase">
            Establish another connection
          </p>
          <PlaidLinkFlow />
        </div>
      </div>
    </main>
  );
}
