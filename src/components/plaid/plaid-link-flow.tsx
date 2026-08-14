"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  usePlaidLink,
  type PlaidLinkOnExit,
  type PlaidLinkOnSuccess,
} from "react-plaid-link";

import type {
  AccountScope,
  PlaidInstitution,
  ReviewAccount,
} from "@/lib/plaid/types";

type ReviewResponse = {
  reviewId: string;
  institution: PlaidInstitution;
  accounts: ReviewAccount[];
};

type Selection = {
  selected: boolean;
  scope: AccountScope;
  acceptDuplicate: boolean;
};
type FlowStage =
  | "idle"
  | "token"
  | "link"
  | "exchange"
  | "review"
  | "activate"
  | "complete"
  | "error";

const TOKEN_STORAGE_KEY = "budget-app.plaid-link-token";

async function api<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as {
    code?: string;
    message?: string;
  } & T;
  if (!response.ok) {
    throw Object.assign(new Error(payload.message ?? "The request failed."), {
      code: payload.code,
      status: response.status,
    });
  }
  return payload;
}

export function PlaidLinkFlow() {
  const [stage, setStage] = useState<FlowStage>("idle");
  const [status, setStatus] = useState(
    "Ready to establish a read-only bank connection.",
  );
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [receivedRedirectUri, setReceivedRedirectUri] = useState<
    string | undefined
  >();
  const [shouldOpen, setShouldOpen] = useState(false);
  const [deterministicOpen, setDeterministicOpen] = useState(false);
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [duplicateOverrideAccountIds, setDuplicateOverrideAccountIds] =
    useState<string[]>([]);
  const [result, setResult] = useState<{
    count: number;
    imported: number;
    importStatus: "complete" | "pending";
  } | null>(null);

  const exchange = useCallback(
    async (publicToken: string, institution: PlaidInstitution) => {
      setStage("exchange");
      setStatus(
        `Secure connection complete. Preparing every account from ${institution.name} for review...`,
      );
      try {
        const response = await api<ReviewResponse>("/api/plaid/exchange", {
          publicToken,
          institution,
        });
        setReview(response);
        setDuplicateOverrideAccountIds([]);
        setSelections(
          Object.fromEntries(
            response.accounts.map((account) => [
              account.providerAccountId,
              {
                selected: account.eligible,
                scope: account.defaultScope,
                acceptDuplicate: false,
              },
            ]),
          ),
        );
        setStage("review");
        setStatus(
          `${response.accounts.length} accounts are ready for your privacy review.`,
        );
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      } catch (error) {
        setStage("error");
        setStatus(
          error instanceof Error
            ? error.message
            : "The connection could not be verified.",
        );
      }
    },
    [],
  );

  const onSuccess = useCallback<PlaidLinkOnSuccess>(
    (publicToken, metadata) => {
      void exchange(publicToken, {
        id: metadata.institution?.institution_id ?? "unknown-institution",
        name: metadata.institution?.name ?? "Connected institution",
      });
    },
    [exchange],
  );

  const onExit = useCallback<PlaidLinkOnExit>((error) => {
    setStage(error ? "error" : "idle");
    setStatus(
      error
        ? "The secure bank window could not finish. Your accounts were not changed; request a fresh connection and try again."
        : "Connection cancelled. Nothing was shared or saved; you can retry whenever you are ready.",
    );
    if (error) sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  }, []);

  // NODE_ENV is compile-time inlined in the client bundle. Production tokens
  // always go through react-plaid-link, even if an upstream response is forged
  // to resemble the local deterministic test token.
  const isDeterministic =
    process.env.NODE_ENV !== "production" &&
    (linkToken?.startsWith("e2e-deterministic-") ?? false);
  const plaid = usePlaidLink({
    token: isDeterministic ? null : linkToken,
    onSuccess,
    onExit,
    receivedRedirectUri,
  });

  useEffect(() => {
    const returningFromOAuth = new URL(window.location.href).searchParams.has(
      "oauth_state_id",
    );
    if (!returningFromOAuth) return;
    const stored = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (!stored) {
      const timeout = window.setTimeout(() => {
        setStage("error");
        setStatus(
          "The bank return could not be resumed because its Link token expired. Start a fresh connection.",
        );
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    const timeout = window.setTimeout(() => {
      setReceivedRedirectUri(window.location.href);
      setLinkToken(stored);
      setShouldOpen(true);
      setStage("link");
      setStatus("Resuming your secure bank connection...");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!shouldOpen || !linkToken) return;
    if (isDeterministic) {
      const timeout = window.setTimeout(() => {
        setDeterministicOpen(true);
        setShouldOpen(false);
      }, 0);
      return () => window.clearTimeout(timeout);
    } else if (plaid.ready) {
      plaid.open();
      const timeout = window.setTimeout(() => setShouldOpen(false), 0);
      return () => window.clearTimeout(timeout);
    }
  }, [isDeterministic, linkToken, plaid, shouldOpen]);

  const startLink = async () => {
    setStage("token");
    setStatus("Requesting a short-lived, read-only connection token...");
    setReview(null);
    setDuplicateOverrideAccountIds([]);
    setResult(null);
    try {
      const response = await api<{ linkToken: string; expiration: string }>(
        "/api/plaid/link-token",
        {},
      );
      sessionStorage.setItem(TOKEN_STORAGE_KEY, response.linkToken);
      setLinkToken(response.linkToken);
      setStage("link");
      setStatus(
        "Secure bank connection is opening. No account is shared until you review it here.",
      );
      setShouldOpen(true);
    } catch (error) {
      setStage("error");
      setStatus(
        error instanceof Error
          ? error.message
          : "A secure connection could not be started.",
      );
    }
  };

  const selectedAccounts = useMemo(
    () =>
      review?.accounts.filter(
        (account) => selections[account.providerAccountId]?.selected,
      ) ?? [],
    [review, selections],
  );

  const activate = async () => {
    if (!review || selectedAccounts.length === 0) {
      setStatus("Select at least one eligible account before activating.");
      return;
    }
    setStage("activate");
    setStatus(
      "Applying your privacy choices and importing the first year of transactions...",
    );
    try {
      const response = await api<{
        activatedAccountIds: string[];
        importedTransactions: number;
        importStatus: "complete" | "pending";
      }>("/api/plaid/activate", {
        reviewId: review.reviewId,
        accounts: selectedAccounts.map((account) => ({
          providerAccountId: account.providerAccountId,
          scope: selections[account.providerAccountId]?.scope ?? "personal",
          ...(selections[account.providerAccountId]?.acceptDuplicate
            ? { acceptDuplicate: true }
            : {}),
        })),
      });
      setResult({
        count: response.activatedAccountIds.length,
        imported: response.importedTransactions,
        importStatus: response.importStatus,
      });
      setStage("complete");
      setStatus(
        response.importStatus === "pending"
          ? `${response.activatedAccountIds.length} accounts activated. Plaid is still preparing transaction history; import will continue shortly.`
          : `${response.activatedAccountIds.length} accounts activated with ${response.importedTransactions} transactions imported.`,
      );
    } catch (error) {
      if ((error as { code?: string }).code === "duplicate_account") {
        // The database re-check can discover a duplicate created after the
        // preview. Expose an explicit override for every selected Family
        // candidate, including candidates whose preview metadata was null.
        setDuplicateOverrideAccountIds(
          selectedAccounts
            .filter(
              (account) =>
                selections[account.providerAccountId]?.scope === "family",
            )
            .map((account) => account.providerAccountId),
        );
        setStage("review");
      } else {
        setStage("error");
      }
      setStatus(
        error instanceof Error ? error.message : "Activation could not finish.",
      );
    }
  };

  const busy = ["token", "exchange", "activate"].includes(stage);

  return (
    <div className="relative">
      <div className="border-line bg-panel/75 grid overflow-hidden rounded-[1.75rem] border shadow-[0_24px_80px_color-mix(in_srgb,var(--ink)_8%,transparent)] lg:grid-cols-[13rem_1fr]">
        <aside className="bg-brand-strong text-surface relative overflow-hidden px-6 py-7 lg:min-h-[37rem] lg:px-7">
          <div
            aria-hidden
            className="border-surface/15 absolute inset-3 rounded-[1.15rem] border"
          />
          <p className="font-utility text-brand relative text-[.62rem] font-semibold tracking-[.16em] uppercase">
            Connection dossier
          </p>
          <ol className="relative mt-9 grid grid-cols-3 gap-2 lg:grid-cols-1 lg:gap-0">
            {[
              ["01", "Establish", ["idle", "token", "link", "exchange"]],
              ["02", "Classify", ["review", "activate"]],
              ["03", "File", ["complete"]],
            ].map(([number, label, stages]) => {
              const active = (stages as string[]).includes(stage);
              return (
                <li
                  key={number as string}
                  className="relative flex gap-3 pb-7 last:pb-0 lg:min-h-28"
                >
                  <span
                    className={`font-utility flex size-8 shrink-0 items-center justify-center rounded-full border text-[.6rem] ${active ? "border-brand bg-brand text-on-accent" : "border-surface/40 text-surface/80"}`}
                  >
                    {number as string}
                  </span>
                  <div>
                    <p
                      // 55% of --surface over --brand-strong lands at ~4.4:1,
                      // just under AA for this size; 75% clears it.
                      className={`font-display text-sm font-semibold ${active ? "text-surface" : "text-surface/75"}`}
                    >
                      {label as string}
                    </p>
                    <span
                      aria-hidden
                      className={`mt-2 hidden h-px w-9 lg:block ${active ? "bg-brand" : "bg-surface/20"}`}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="text-surface/65 relative mt-8 hidden text-xs leading-5 lg:block">
            Read-only access. Canadian institutions. Privacy chosen account by
            account.
          </p>
        </aside>

        <section className="bg-surface min-w-0 px-5 py-7 sm:px-8 sm:py-9 lg:px-10">
          <div className="border-line flex flex-col gap-5 border-b pb-7 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-utility text-mineral text-[.65rem] font-semibold tracking-[.14em] uppercase">
                File no. CA-365
              </p>
              <h2 className="font-display text-ink mt-2 text-3xl leading-none font-semibold tracking-[-.05em] sm:text-4xl">
                Your accounts,
                <br />
                on your terms.
              </h2>
            </div>
            <button
              type="button"
              data-testid="plaid-connect"
              onClick={() => void startLink()}
              disabled={busy}
              className="bg-brand text-surface hover:bg-brand-strong focus-visible:outline-mineral inline-flex min-h-12 items-center justify-center rounded-full px-5 text-sm font-bold transition-[background,transform] hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-wait disabled:opacity-60"
            >
              {stage === "idle" || stage === "error"
                ? "Connect a Canadian bank"
                : stage === "complete"
                  ? "Connect another bank"
                  : "Connection in progress"}
            </button>
          </div>

          <div
            data-testid="plaid-status"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="border-line bg-panel text-ink mt-5 flex min-h-14 items-start gap-3 rounded-xl border px-4 py-3 text-sm leading-6"
          >
            <span
              aria-hidden
              className={`mt-2 size-2 shrink-0 rounded-full ${stage === "error" ? "bg-alert" : stage === "complete" ? "bg-brand" : "bg-mineral"}`}
            />
            <p>{status}</p>
          </div>

          {review ? (
            <div data-testid="plaid-review" className="mt-8">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="font-utility text-brand text-[.64rem] tracking-[.14em] uppercase">
                    {review.institution.name}
                  </p>
                  <h3 className="font-display text-ink mt-1 text-2xl font-semibold tracking-[-.04em]">
                    Account classification
                  </h3>
                </div>
                <p className="text-muted max-w-xs text-xs leading-5">
                  Personal stays visible only to you. Family becomes visible to
                  every active family member.
                </p>
              </div>

              <div className="border-line mt-5 divide-y overflow-hidden rounded-2xl border">
                {review.accounts.map((account, index) => {
                  const selection = selections[account.providerAccountId] ?? {
                    selected: false,
                    scope: "personal",
                    acceptDuplicate: false,
                  };
                  const testId = `plaid-account-${account.providerAccountId}`;
                  return (
                    <article
                      key={account.providerAccountId}
                      data-testid={testId}
                      tabIndex={account.eligible ? undefined : 0}
                      className="bg-surface focus-visible:outline-brand grid gap-4 p-4 focus-visible:outline-2 focus-visible:outline-offset-[-2px] sm:grid-cols-[auto_1fr_auto] sm:items-center sm:p-5"
                    >
                      <label className="flex size-10 items-center justify-center">
                        <input
                          type="checkbox"
                          data-testid={`${testId}-selected`}
                          checked={selection.selected}
                          disabled={!account.eligible}
                          aria-label={`Include ${account.name}`}
                          onChange={(event) =>
                            setSelections((current) => ({
                              ...current,
                              [account.providerAccountId]: {
                                ...selection,
                                selected: event.target.checked,
                              },
                            }))
                          }
                          className="border-line text-brand focus-visible:outline-brand size-5 rounded accent-[var(--brand)] focus-visible:outline-2 focus-visible:outline-offset-3"
                        />
                      </label>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <p className="font-display text-ink text-lg font-semibold tracking-[-.025em]">
                            {account.name}
                          </p>
                          <span className="font-utility text-muted text-[.6rem]">
                            {account.mask
                              ? `Ending ${account.mask}`
                              : "No mask"}{" "}
                            / {account.currencyCode ?? "Currency unknown"}
                          </span>
                        </div>
                        <p className="text-muted mt-1 text-xs leading-5">
                          {account.officialName ??
                            `${account.type} / ${account.subtype ?? "unspecified"}`}
                        </p>
                        {!account.eligible ? (
                          <p
                            data-testid={`${testId}-eligibility`}
                            className="text-alert mt-2 text-xs leading-5 font-semibold"
                          >
                            {account.eligibilityMessage}
                          </p>
                        ) : null}
                        {(account.duplicate ||
                          duplicateOverrideAccountIds.includes(
                            account.providerAccountId,
                          )) &&
                        selection.selected &&
                        selection.scope === "family" ? (
                          <div
                            data-testid={`${testId}-duplicate`}
                            className="text-alert mt-2 text-xs leading-5"
                          >
                            <p>
                              {account.duplicate ? (
                                <>
                                  Likely duplicate: this matches{" "}
                                  {account.duplicate.displayName} at{" "}
                                  {account.duplicate.institutionName}
                                  {account.duplicate.mask
                                    ? ` ending ${account.duplicate.mask}`
                                    : ""}
                                  .
                                </>
                              ) : (
                                <>
                                  A matching Family account appeared after this
                                  review was prepared.
                                </>
                              )}
                            </p>
                            {duplicateOverrideAccountIds.includes(
                              account.providerAccountId,
                            ) &&
                            selection.scope === "family" &&
                            selection.selected ? (
                              <label className="border-alert/30 bg-alert/5 text-ink mt-3 flex items-start gap-3 rounded-xl border p-3">
                                <input
                                  type="checkbox"
                                  checked={selection.acceptDuplicate}
                                  aria-label={`Add ${account.name} anyway and override duplicate warning`}
                                  onChange={(event) =>
                                    setSelections((current) => ({
                                      ...current,
                                      [account.providerAccountId]: {
                                        ...selection,
                                        acceptDuplicate: event.target.checked,
                                      },
                                    }))
                                  }
                                  className="mt-1 size-4 accent-[var(--alert)]"
                                />
                                Add this Family account anyway. I understand it
                                may duplicate an existing shared account.
                              </label>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      {account.eligible ? (
                        <fieldset
                          disabled={!selection.selected}
                          className="border-line bg-panel flex rounded-full border p-1 disabled:opacity-50"
                        >
                          <legend className="sr-only">
                            Visibility for {account.name}
                          </legend>
                          {(["personal", "family"] as const).map((scope) => (
                            <label
                              key={scope}
                              className={`relative cursor-pointer rounded-full px-3 py-2 text-xs font-bold capitalize ${selection.scope === scope ? "bg-surface text-brand shadow-sm" : "text-muted"}`}
                            >
                              <input
                                type="radio"
                                name={`scope-${index}`}
                                value={scope}
                                checked={selection.scope === scope}
                                data-testid={`${testId}-scope-${scope}`}
                                onChange={() =>
                                  setSelections((current) => ({
                                    ...current,
                                    [account.providerAccountId]: {
                                      ...selection,
                                      scope,
                                    },
                                  }))
                                }
                                className="sr-only"
                              />
                              {scope}
                            </label>
                          ))}
                        </fieldset>
                      ) : null}
                    </article>
                  );
                })}
              </div>

              <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-utility text-muted text-[.62rem] tracking-[.08em] uppercase">
                  {selectedAccounts.length} eligible account
                  {selectedAccounts.length === 1 ? "" : "s"} selected
                </p>
                <button
                  type="button"
                  data-testid="plaid-activate"
                  onClick={() => void activate()}
                  disabled={
                    stage === "activate" || selectedAccounts.length === 0
                  }
                  className="border-brand text-brand hover:bg-brand hover:text-surface focus-visible:outline-brand inline-flex min-h-12 items-center justify-center rounded-full border-2 px-6 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Activate selected accounts
                </button>
              </div>
            </div>
          ) : null}

          {stage === "error" || status.startsWith("Connection cancelled") ? (
            <button
              type="button"
              data-testid="plaid-retry"
              onClick={() => void startLink()}
              className="text-brand focus-visible:outline-brand mt-5 rounded-md text-sm font-bold underline decoration-1 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
            >
              Request a fresh connection
            </button>
          ) : null}

          {result ? (
            <div className="border-brand/30 bg-brand/5 mt-7 rounded-2xl border p-5">
              <p className="font-display text-ink text-xl font-semibold">
                Dossier filed.
              </p>
              <p className="text-muted mt-2 text-sm leading-6">
                {result.count} account{result.count === 1 ? "" : "s"} activated.{" "}
                {result.importStatus === "pending"
                  ? "Transaction history is pending at Plaid."
                  : `${result.imported} transactions imported.`}
              </p>
            </div>
          ) : null}
        </section>
      </div>

      {deterministicOpen && isDeterministic ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="e2e-bank-title"
          className="bg-ink/60 fixed inset-0 z-50 grid place-items-center p-5 backdrop-blur-sm"
        >
          <div className="bg-surface border-line w-full max-w-md rounded-3xl border p-7 shadow-2xl">
            <p className="font-utility text-brand text-[.62rem] tracking-[.14em] uppercase">
              Local E2E provider
            </p>
            <h3
              id="e2e-bank-title"
              className="font-display text-ink mt-2 text-3xl font-semibold tracking-[-.05em]"
            >
              E2E Canadian Bank
            </h3>
            <p className="text-muted mt-3 text-sm leading-6">
              This deterministic server-side provider exercises the application
              flow without external Plaid credentials.
            </p>
            <div className="mt-6 grid gap-2">
              <button
                type="button"
                onClick={() => {
                  setDeterministicOpen(false);
                  void exchange("e2e-public-success", {
                    id: "ins_e2e",
                    name: "E2E Canadian Bank",
                  });
                }}
                className="bg-brand text-surface focus-visible:outline-brand min-h-12 rounded-full px-5 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-4"
              >
                Continue with E2E bank
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeterministicOpen(false);
                  onExit(null, {
                    institution: null,
                    status: null,
                    link_session_id: "e2e",
                    request_id: "e2e",
                  });
                }}
                className="text-muted focus-visible:outline-brand min-h-11 rounded-full px-5 text-sm font-semibold focus-visible:outline-2"
              >
                Cancel secure connection
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
