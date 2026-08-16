"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { PendingButton } from "@/components/pending-button";
import { usePendingAction } from "@/hooks/use-pending-action";
import type {
  AccountScope,
  PlaidConnection,
  PlaidDisconnectMode,
  PlaidUpdateReason,
} from "@/lib/plaid/types";

type ApiError = { code?: string; message?: string };
async function request<T>(
  path: string,
  method: "POST" | "PATCH",
  body: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as T & ApiError;
  if (!response.ok)
    throw new Error(payload.message ?? "The operation could not be completed.");
  return payload;
}
function money(cents: number | null) {
  return cents == null
    ? "Balance unavailable"
    : new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency: "CAD",
      }).format(cents / 100);
}
function date(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-CA", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Not yet synced";
}

type RunMutation = (
  action: string,
  work: () => Promise<void>,
) => Promise<void | undefined>;

function UpdateControl({
  itemId,
  onReconcile,
  announce,
  pending,
  pendingAction,
  runMutation,
}: {
  itemId: string;
  onReconcile: () => Promise<void>;
  announce: (text: string) => void;
  pending: boolean;
  pendingAction: string;
  runMutation: RunMutation;
}) {
  const [reason, setReason] = useState<PlaidUpdateReason>("login_repair");
  const [token, setToken] = useState<string | null>(null);
  const [shouldOpen, setShouldOpen] = useState(false);
  const onSuccess = useCallback(() => {
    setShouldOpen(false);
    setToken(null);
    void runMutation(`reconcile:${itemId}`, onReconcile);
  }, [itemId, onReconcile, runMutation]);
  const plaid = usePlaidLink({
    token,
    onSuccess,
    onExit: (error) => {
      setShouldOpen(false);
      setToken(null);
      announce(
        error
          ? "Plaid could not finish the update. Nothing local was changed."
          : "Bank update cancelled.",
      );
    },
  });
  const { open: openPlaid, ready: plaidReady } = plaid;
  useEffect(() => {
    if (!shouldOpen || !token || !plaidReady) return;
    openPlaid();
    const timeout = window.setTimeout(() => setShouldOpen(false), 0);
    return () => window.clearTimeout(timeout);
  }, [openPlaid, plaidReady, shouldOpen, token]);
  async function open() {
    await runMutation(`update:${itemId}`, async () => {
      announce("Preparing Plaid update mode for every account in this Item…");
      try {
        const result = await request<{ linkToken: string }>(
          `/api/plaid/connections/${itemId}/update-token`,
          "POST",
          { reason },
        );
        if (
          process.env.NODE_ENV !== "production" &&
          result.linkToken.startsWith("e2e-deterministic-")
        ) {
          setToken(null);
          await onReconcile();
        } else {
          setToken(result.linkToken);
          setShouldOpen(true);
        }
      } catch (error) {
        announce(
          error instanceof Error
            ? error.message
            : "Plaid update mode could not start.",
        );
      }
    });
  }
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
      <label className="sr-only" htmlFor={`plaid-reason-${itemId}`}>
        Update reason
      </label>
      <select
        id={`plaid-reason-${itemId}`}
        value={reason}
        disabled={pending}
        onChange={(event) => setReason(event.target.value as PlaidUpdateReason)}
        className="border-line bg-background text-ink rounded-sm border px-3 py-2 text-sm"
      >
        <option value="login_repair">Repair sign-in</option>
        <option value="consent">Renew consent</option>
        <option value="permissions">Repair permissions</option>
        <option value="account_selection">Change selected accounts</option>
      </select>
      <PendingButton
        data-testid={`plaid-update-${itemId}`}
        type="button"
        onClick={() => void open()}
        disabled={pending || (!plaidReady && token !== null)}
        pending={pending && pendingAction === `update:${itemId}`}
        pendingLabel="Preparing update…"
        className="bg-ink text-surface focus-visible:outline-brand rounded-sm px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
      >
        Open secure update
      </PendingButton>
    </div>
  );
}

export function PlaidConnectionManager({
  initialConnections,
}: {
  initialConnections: PlaidConnection[];
}) {
  const [connections, setConnections] = useState(initialConnections);
  const [status, setStatus] = useState("Connection management is ready.");
  const [warnings, setWarnings] = useState<
    Record<string, AccountScope | undefined>
  >({});
  const [visibilityAcknowledged, setVisibilityAcknowledged] = useState<
    Record<string, boolean>
  >({});
  const [modes, setModes] = useState<Record<string, PlaidDisconnectMode>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState("");
  const { pending, run } = usePendingAction();
  const runMutation = useCallback<RunMutation>(
    (action, work) =>
      run(async () => {
        setPendingAction(action);
        await work();
      }),
    [run],
  );
  const refresh = useCallback(async () => {
    const response = await fetch("/api/plaid/connections", {
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      connections?: PlaidConnection[];
      message?: string;
    };
    if (!response.ok || !payload.connections)
      throw new Error(payload.message ?? "Connections could not be refreshed.");
    setConnections(payload.connections);
  }, []);
  const reconcile = useCallback(
    async (itemId: string, deleteIds: string[] = []) => {
      setStatus("Checking Plaid for the fresh account set…");
      try {
        const result = await request<{
          connection: PlaidConnection;
          addedAccountIds: string[];
          returnedAccountIds: string[];
          deselectedAccounts: unknown[];
        }>(`/api/plaid/connections/${itemId}/reconcile`, "POST", {
          deleteDeselectedAccountIds: deleteIds,
        });
        setConnections((current) =>
          current.map((connection) =>
            connection.itemId === itemId ? result.connection : connection,
          ),
        );
        setStatus(
          `Reconciliation complete: ${result.addedAccountIds.length} new, ${result.returnedAccountIds.length} returned, ${result.deselectedAccounts.length} deselected.`,
        );
      } catch (error) {
        setStatus(
          error instanceof Error ? error.message : "Reconciliation failed.",
        );
      }
    },
    [],
  );
  async function visibility(
    itemId: string,
    accountId: string,
    scope: AccountScope,
  ) {
    await runMutation(`visibility:${accountId}`, async () => {
      setStatus("Applying the privacy boundary and recalculating history…");
      try {
        const result = await request<{ connection: PlaidConnection }>(
          `/api/plaid/connections/${itemId}/visibility`,
          "PATCH",
          { accountId, scope, acknowledgeRetroactiveImpact: true },
        );
        setConnections((current) =>
          current.map((connection) =>
            connection.itemId === itemId ? result.connection : connection,
          ),
        );
        setWarnings((current) => ({ ...current, [accountId]: undefined }));
        setVisibilityAcknowledged((current) => ({
          ...current,
          [accountId]: false,
        }));
        setStatus(
          "Visibility changed. Dashboards and budgets now use the new scope retroactively.",
        );
      } catch (error) {
        setStatus(
          error instanceof Error
            ? error.message
            : "Visibility could not be changed.",
        );
      }
    });
  }
  async function disconnect(itemId: string) {
    const mode = modes[itemId] ?? "keep_history";
    await runMutation(`disconnect:${itemId}`, async () => {
      setStatus("Revoking provider access and securing local history…");
      try {
        await request(`/api/plaid/connections/${itemId}/disconnect`, "POST", {
          mode,
        });
        await refresh();
        setConfirming(null);
        setStatus(
          mode === "keep_history"
            ? "Disconnected. Existing history is retained read-only."
            : "Disconnected. This Item’s local account data was deleted.",
        );
      } catch (error) {
        setStatus(
          error instanceof Error
            ? error.message
            : "Disconnect could not finish.",
        );
      }
    });
  }
  return (
    <section
      data-testid="plaid-connections"
      aria-labelledby="connection-register-title"
      className="mt-10 w-full max-w-full overflow-x-hidden"
    >
      <div className="border-line mb-5 flex flex-col gap-3 border-y py-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-utility text-brand text-[.66rem] font-bold tracking-[.18em] uppercase">
            Linked institution register
          </p>
          <h2
            id="connection-register-title"
            className="font-display mt-1 text-3xl font-semibold tracking-[-.04em]"
          >
            Connection custody
          </h2>
        </div>
        <p className="text-muted max-w-xl text-sm leading-6">
          Only connections you personally linked appear here. Item-wide actions
          can reach several accounts; every privacy change rewrites reporting
          history without undoing data already viewed or exported.
        </p>
      </div>
      {connections.length === 0 ? (
        <div className="border-line bg-surface border p-6">
          <p className="font-display text-2xl">No managed connections yet.</p>
          <p className="text-muted mt-2 text-sm">
            Connect a bank below to begin a linker-owned dossier.
          </p>
        </div>
      ) : null}
      <div className="grid gap-7">
        {connections.map((connection, index) => (
          <article
            key={connection.itemId}
            data-testid={`plaid-connection-${connection.itemId}`}
            className="border-line bg-surface relative overflow-hidden border shadow-[0_16px_40px_color-mix(in_srgb,var(--ink)_8%,transparent)]"
          >
            <div className="grid lg:grid-cols-[.72fr_1.55fr]">
              <header className="bg-panel border-line border-b p-6 lg:border-r lg:border-b-0 lg:p-8">
                <p className="font-utility text-muted text-[.64rem] font-bold tracking-[.17em] uppercase">
                  Item {String(index + 1).padStart(2, "0")} · linked by you
                </p>
                <h3 className="font-display mt-4 text-4xl leading-none font-semibold tracking-[-.055em]">
                  {connection.institutionName}
                </h3>
                <p
                  data-testid={`plaid-health-${connection.itemId}`}
                  className="mt-5 flex items-center gap-2 text-sm font-semibold"
                >
                  <span
                    aria-hidden
                    className={`h-2.5 w-2.5 ${connection.health === "healthy" ? "bg-brand rounded-full" : connection.health === "attention" ? "bg-alert rotate-45" : "border-muted border"}`}
                  />
                  {connection.health === "healthy"
                    ? "Healthy"
                    : connection.health === "attention"
                      ? "Needs attention"
                      : "Disconnected"}
                </p>
                <dl className="border-line mt-6 grid gap-3 border-t pt-5 text-sm">
                  <div>
                    <dt className="text-muted">Last synchronized</dt>
                    <dd className="font-medium">
                      {date(connection.lastSyncAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Consent expiry</dt>
                    <dd className="font-medium">
                      {connection.consentExpiresAt
                        ? date(connection.consentExpiresAt)
                        : "No expiry reported"}
                    </dd>
                  </div>
                </dl>
              </header>
              <div className="p-5 sm:p-7">
                <p
                  data-testid={`plaid-item-impact-${connection.itemId}`}
                  className="border-mineral/40 bg-background text-muted border-l-4 px-4 py-3 text-sm leading-6"
                >
                  <strong className="text-ink">Item-wide impact.</strong>{" "}
                  {connection.itemImpact.message}
                </p>
                <div className="mt-5 grid gap-3">
                  {connection.accounts.map((account) => (
                    <div
                      key={account.accountId}
                      data-testid={`plaid-account-${account.accountId}`}
                      className="border-line bg-background grid gap-4 border p-4 sm:grid-cols-[1fr_auto] sm:items-start"
                    >
                      <div>
                        <div className="flex flex-wrap items-baseline gap-2">
                          <h4 className="font-display text-xl font-semibold">
                            {account.displayName}
                          </h4>
                          <span className="font-utility text-muted text-xs tracking-widest">
                            •••• {account.mask ?? "—"}
                          </span>
                        </div>
                        <p className="text-muted mt-1 text-xs tracking-wider uppercase">
                          {account.kind.replace("_", " ")} · {account.scope} ·{" "}
                          {account.ownerDisplayName ?? "Family"} ·{" "}
                          {account.lifecycle}
                          {account.readOnly ? " · read only" : ""}
                        </p>
                        <p className="mt-3 text-lg font-semibold">
                          {money(account.currentBalanceCents)}
                        </p>
                        <p className="text-muted text-xs">
                          Available {money(account.availableBalanceCents)} ·
                          balance updated {date(account.balanceUpdatedAt)} ·
                          last sync {date(account.lastSyncAt)}
                        </p>
                      </div>
                      {account.lifecycle === "live" ? (
                        <div className="min-w-52">
                          <label
                            htmlFor={`scope-${account.accountId}`}
                            className="text-muted block text-xs font-semibold tracking-wider uppercase"
                          >
                            Visibility
                          </label>
                          <select
                            data-testid={`plaid-visibility-${account.accountId}`}
                            id={`scope-${account.accountId}`}
                            value={account.scope}
                            disabled={pending}
                            onChange={(event) => {
                              setWarnings((current) => ({
                                ...current,
                                [account.accountId]: event.target
                                  .value as AccountScope,
                              }));
                              setVisibilityAcknowledged((current) => ({
                                ...current,
                                [account.accountId]: false,
                              }));
                            }}
                            className="border-line bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
                          >
                            <option value="personal">Personal · only me</option>
                            <option value="family">Family · shared</option>
                          </select>
                          {warnings[account.accountId] &&
                          warnings[account.accountId] !== account.scope ? (
                            <div
                              data-testid={`plaid-visibility-warning-${account.accountId}`}
                              className="border-alert/40 bg-alert/5 mt-2 border p-3 text-xs leading-5"
                            >
                              <strong>Retroactive change.</strong> Dashboards
                              and budgets recalculate across existing
                              transactions. It cannot undo prior viewing or
                              export.
                              <label className="mt-2 flex items-start gap-2">
                                <input
                                  type="checkbox"
                                  disabled={pending}
                                  checked={
                                    visibilityAcknowledged[account.accountId] ??
                                    false
                                  }
                                  onChange={(event) =>
                                    setVisibilityAcknowledged((current) => ({
                                      ...current,
                                      [account.accountId]: event.target.checked,
                                    }))
                                  }
                                />
                                <span>
                                  I acknowledge the irreversible historical
                                  impact.
                                </span>
                              </label>
                              <PendingButton
                                type="button"
                                disabled={
                                  pending ||
                                  !visibilityAcknowledged[account.accountId]
                                }
                                pending={
                                  pending &&
                                  pendingAction ===
                                    `visibility:${account.accountId}`
                                }
                                pendingLabel="Applying visibility…"
                                onClick={() =>
                                  void visibility(
                                    connection.itemId,
                                    account.accountId,
                                    warnings[account.accountId]!,
                                  )
                                }
                                className="bg-alert text-surface mt-2 block w-full rounded-sm px-3 py-2 font-bold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                              >
                                Confirm and apply visibility
                              </PendingButton>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div>
                          {account.lifecycle === "deselected" ? (
                            <div
                              data-testid={`plaid-deselected-${account.accountId}`}
                              className="border-alert/40 border-l-2 pl-3 text-xs"
                            >
                              <strong>Deselected at Plaid</strong>
                              <p className="text-muted mt-1">
                                History is frozen read-only.
                              </p>
                              <PendingButton
                                data-testid={`plaid-delete-deselected-${account.accountId}`}
                                type="button"
                                disabled={pending}
                                pending={
                                  pending &&
                                  pendingAction ===
                                    `reconcile:${connection.itemId}`
                                }
                                pendingLabel="Reconciling…"
                                onClick={() =>
                                  void runMutation(
                                    `reconcile:${connection.itemId}`,
                                    () =>
                                      reconcile(connection.itemId, [
                                        account.accountId,
                                      ]),
                                  )
                                }
                                className="text-alert mt-2 underline underline-offset-4"
                              >
                                Delete this account’s local data
                              </PendingButton>
                            </div>
                          ) : (
                            <span className="text-muted text-xs">
                              Retained history
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {connection.status !== "revoked" ? (
                  <div className="border-line mt-6 grid gap-4 border-t pt-5">
                    <UpdateControl
                      itemId={connection.itemId}
                      onReconcile={() => reconcile(connection.itemId)}
                      announce={setStatus}
                      pending={pending}
                      pendingAction={pendingAction}
                      runMutation={runMutation}
                    />
                    <PendingButton
                      data-testid={`plaid-reconcile-${connection.itemId}`}
                      type="button"
                      disabled={pending}
                      pending={
                        pending &&
                        pendingAction === `reconcile:${connection.itemId}`
                      }
                      pendingLabel="Reconciling…"
                      onClick={() =>
                        void runMutation(`reconcile:${connection.itemId}`, () =>
                          reconcile(connection.itemId),
                        )
                      }
                      className="border-line hover:border-brand focus-visible:outline-brand rounded-sm border px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      Reconcile fresh account set
                    </PendingButton>
                    <div className="bg-panel grid gap-3 p-4">
                      <label className="grid gap-2 text-sm font-semibold">
                        Disconnect consequence
                        <select
                          data-testid={`plaid-disconnect-mode-${connection.itemId}`}
                          value={modes[connection.itemId] ?? "keep_history"}
                          disabled={pending}
                          onChange={(event) =>
                            setModes((current) => ({
                              ...current,
                              [connection.itemId]: event.target
                                .value as PlaidDisconnectMode,
                            }))
                          }
                          className="border-line bg-surface text-ink rounded-sm border px-3 py-3 text-sm"
                        >
                          <option value="keep_history">
                            Keep history · retain read-only records
                          </option>
                          <option value="delete_data">
                            Delete data · permanently remove local records
                          </option>
                        </select>
                      </label>
                      <p className="text-muted text-xs leading-5">
                        Both modes revoke Plaid access for every account in this
                        Item. A password confirmation from the last 15 minutes
                        is required.
                      </p>
                      {confirming === connection.itemId ? (
                        <div
                          data-testid={`plaid-disconnect-confirm-${connection.itemId}`}
                          className="border-alert border p-3 text-sm"
                        >
                          <strong>
                            This affects {connection.itemImpact.accountCount}{" "}
                            account
                            {connection.itemImpact.accountCount === 1
                              ? ""
                              : "s"}
                            .
                          </strong>
                          <p className="text-muted mt-2 text-xs leading-5">
                            Confirming below acknowledges this Item-wide,
                            irreversible provider disconnect.
                          </p>
                          <div className="mt-3 flex gap-2">
                            <PendingButton
                              type="button"
                              disabled={pending}
                              pending={
                                pending &&
                                pendingAction ===
                                  `disconnect:${connection.itemId}`
                              }
                              pendingLabel="Disconnecting…"
                              onClick={() => void disconnect(connection.itemId)}
                              className="bg-alert text-surface rounded-sm px-3 py-2 font-semibold disabled:opacity-50"
                            >
                              Confirm disconnect
                            </PendingButton>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => {
                                setConfirming(null);
                              }}
                              className="border-line rounded-sm border px-3 py-2"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          data-testid={`plaid-disconnect-${connection.itemId}`}
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            setConfirming(connection.itemId);
                          }}
                          className="text-alert focus-visible:outline-alert justify-self-start text-sm font-semibold underline decoration-2 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                          Disconnect institution
                        </button>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
      <p
        data-testid="plaid-operation-status"
        className="border-line bg-ink text-surface sticky bottom-4 z-10 mx-auto mt-6 max-w-2xl border px-4 py-3 text-center text-sm shadow-xl"
      >
        {status}
      </p>
      <span
        data-testid="plaid-operation-announcement"
        className="sr-only"
        role="status"
        aria-live="polite"
      >
        {pending || status === "Connection management is ready." ? "" : status}
      </span>
    </section>
  );
}
