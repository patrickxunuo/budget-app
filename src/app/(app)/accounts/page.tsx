import type { Metadata } from "next";

import { PlaidConnectionManager } from "@/components/plaid/plaid-connection-manager";
import { PlaidLinkFlow } from "@/components/plaid/plaid-link-flow";
import { PlaidSyncStatus } from "@/components/plaid/plaid-sync-status";
import { requireActiveMembership } from "@/lib/auth/dal";
import { getPlaidConnections } from "@/lib/plaid/connection-management";
import { getPlaidSyncStatuses } from "@/lib/plaid/sync-service";
import { delayRouteForE2E } from "@/lib/testing/route-loading-delay";

export const metadata: Metadata = {
  title: "Accounts",
  description:
    "Connect, inspect, and safely manage read-only Canadian bank accounts.",
};

export default async function AccountsPage() {
  await delayRouteForE2E();
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
      className="min-w-0 overflow-x-hidden px-4 py-5 sm:px-8 sm:py-7 lg:px-12"
    >
      <div className="mx-auto max-w-6xl">
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
